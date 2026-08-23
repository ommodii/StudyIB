from __future__ import annotations

import json
import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pypdf import PdfReader
from reportlab.pdfgen import canvas

from scripts.create_topic_paper_sample import create_sample
from scripts.topic_papers.classify import classify_question, validate_classification_result
from scripts.topic_papers.compiled_sample import (
    Marker,
    Region,
    SliceRecord,
    _apply_override,
    _mark_duplicates,
    _reference_metadata,
    detect_regions,
    write_slice,
)
from scripts.topic_papers.dedupe import mark_duplicates
from scripts.topic_papers.inventory import inventory_sources, parse_paper_metadata
from scripts.topic_papers.local_guard import LocalOnlyViolation, assert_local_only, assert_safe_process
from scripts.topic_papers.models import PageRegion, QuestionRecord
from scripts.topic_papers.pdf_extract import Boundary, build_regions, detect_question_boundaries, extract_questions, stable_question_id
from scripts.topic_papers.pipeline import PipelineOptions, _apply_computer_science_option_fallback, _classification_scope, run_pipeline
from scripts.topic_papers.production import classify_with_priors, math_source_candidates, page_fingerprint, topic_priors
from scripts.topic_papers.reporting import write_reports
from scripts.topic_papers.taxonomy import load_taxonomy, validate_taxonomy


REPO_ROOT = Path(__file__).resolve().parents[1]


def make_question(question_id: str, text: str, year: int = 2020) -> QuestionRecord:
    return QuestionRecord(
        question_id=question_id,
        subject="physics",
        course="NONE",
        year=year,
        session="May",
        timezone="TZ1",
        level="HL",
        paper="P2",
        question_number="1",
        source_path=f"{question_id}.pdf",
        source_pages=[1],
        regions=[PageRegion(0, 0, 800, True, False)],
        extracted_text=text,
        normalized_text=text.lower(),
        text_hash=question_id,
    )


class InventoryTests(unittest.TestCase):
    def test_tolerant_filename_metadata_parsing(self) -> None:
        path = Path("2022 May Examination Session/Mathematics_analysis_and_approaches_paper_2__TZ2_HL_markscheme.pdf")
        record = parse_paper_metadata(path, "mathematics")
        self.assertEqual((record.year, record.session, record.timezone), (2022, "May", "TZ2"))
        self.assertEqual((record.level, record.paper, record.role, record.course), ("HL", "P2", "markscheme", "aa"))

    def test_unknown_legacy_math_course_is_preserved(self) -> None:
        record = parse_paper_metadata(Path("2005 November Examination Session/Mathematics_paper_1_HL.pdf"), "mathematics")
        self.assertEqual(record.course, "UNKNOWN")
        self.assertIn("course", record.reason)

    def test_ambiguous_metadata_ids_include_source_fingerprint(self) -> None:
        left = parse_paper_metadata(Path("one/Physics_paper_1_HL.pdf"), "physics")
        right = parse_paper_metadata(Path("two/Physics_paper_1_HL.pdf"), "physics")
        self.assertNotEqual(stable_question_id(left, "1"), stable_question_id(right, "1"))


class BoundaryTests(unittest.TestCase):
    def test_geometry_boundary_detection_rejects_table_rows(self) -> None:
        texts = ["1. Experiment\n2 0.0 24.8\n3 1.0 24.8\n2. Calculate"]
        words = [[
            {"text": "1.", "x0": 42, "x1": 52, "top": 100},
            {"text": "Experiment", "x0": 70, "x1": 130, "top": 100},
            {"text": "2", "x0": 65, "x1": 72, "top": 300},
            {"text": "0.0", "x0": 107, "x1": 126, "top": 300},
            {"text": "3", "x0": 65, "x1": 72, "top": 315},
            {"text": "1.0", "x0": 107, "x1": 126, "top": 315},
            {"text": "2.", "x0": 42, "x1": 52, "top": 600},
            {"text": "Calculate", "x0": 70, "x1": 120, "top": 600},
        ]]
        boundaries = detect_question_boundaries(texts, words, [595.0], [842.0])
        self.assertEqual([(item.question_number, item.top) for item in boundaries], [("1", 100.0), ("2", 600.0)])

    def test_indented_numbered_source_paragraphs_are_not_questions(self) -> None:
        words = [[
            {"text": "1.", "x0": 42, "x1": 52, "top": 100},
            {"text": "Study", "x0": 70, "x1": 100, "top": 100},
            {"text": "1", "x0": 62, "x1": 68, "top": 160},
            {"text": "First", "x0": 76, "x1": 100, "top": 160},
            {"text": "2", "x0": 62, "x1": 68, "top": 220},
            {"text": "Second", "x0": 76, "x1": 110, "top": 220},
            {"text": "2.", "x0": 56, "x1": 66, "top": 300},
            {"text": "Table", "x0": 72, "x1": 100, "top": 300},
        ], [
            {"text": "2.", "x0": 42, "x1": 52, "top": 100},
            {"text": "Study", "x0": 70, "x1": 100, "top": 100},
        ]]
        boundaries = detect_question_boundaries(["1. Study\n1 First\n2 Second", "2. Study"], words, [595, 595], [842, 842])
        self.assertEqual([item.question_number for item in boundaries], ["1", "2"])

    def test_geometry_boundary_detection_rejects_inline_answer_label(self) -> None:
        texts = ["39. Units\nA. s4 A2 m-2 kg-1\n40. Photons"]
        words = [[
            {"text": "39.", "x0": 42, "x1": 56, "top": 210},
            {"text": "Units", "x0": 70, "x1": 100, "top": 210},
            {"text": "A2", "x0": 109, "x1": 121, "top": 240},
            {"text": "m-2", "x0": 125, "x1": 145, "top": 240},
            {"text": "40.", "x0": 42, "x1": 56, "top": 360},
            {"text": "Photons", "x0": 70, "x1": 110, "top": 360},
        ]]
        boundaries = detect_question_boundaries(texts, words, [595.0], [842.0])
        self.assertEqual([item.question_number for item in boundaries], ["39", "40"])

    def test_exam_code_header_normalizes_to_empty(self) -> None:
        from scripts.topic_papers.pdf_extract import normalize_text

        self.assertEqual(normalize_text("– 3 – M15/4/PHYSI/HPM/ENG/TZ2/XX"), "")

    def test_exam_code_does_not_erase_flattened_question_text(self) -> None:
        from scripts.topic_papers.pdf_extract import normalize_text

        text = "9. The matrix is singular. Find the values of k. M01/510/H(1) Turn over"
        self.assertEqual(normalize_text(text), "9. the matrix is singular. find the values of k.")

    def test_lone_year_does_not_interrupt_option_question(self) -> None:
        words = [[
            {"text": "G3.", "x0": 42, "x1": 58, "top": 70},
            {"text": "This", "x0": 70, "x1": 94, "top": 70},
            {"text": "29", "x0": 88, "x1": 100, "top": 104},
            {"text": "March", "x0": 103, "x1": 140, "top": 104},
        ], [
            {"text": "G4.", "x0": 42, "x1": 58, "top": 310},
            {"text": "Next", "x0": 70, "x1": 96, "top": 310},
        ]]
        boundaries = detect_question_boundaries(["G3. This\nOn 29 March", "G4. Next"], words, [595.0, 595.0], [842.0, 842.0])
        self.assertEqual([item.question_number for item in boundaries], ["G3", "G4"])

    def test_numbered_list_after_option_questions_is_not_main_sequence(self) -> None:
        words = [[
            {"text": "G1.", "x0": 28, "x1": 42, "top": 90},
            {"text": "Explain", "x0": 57, "x1": 96, "top": 90},
            {"text": "G2.", "x0": 28, "x1": 42, "top": 300},
            {"text": "Study", "x0": 57, "x1": 86, "top": 300},
            {"text": "1.", "x0": 85, "x1": 94, "top": 360},
            {"text": "Species", "x0": 99, "x1": 140, "top": 360},
            {"text": "2.", "x0": 85, "x1": 94, "top": 380},
            {"text": "Species", "x0": 99, "x1": 140, "top": 380},
        ]]
        boundaries = detect_question_boundaries(["G1. Explain\nG2. Study\n1. Species\n2. Species"], words, [595.0], [842.0])
        self.assertEqual([item.question_number for item in boundaries], ["G1", "G2"])

    def test_continuation_and_shared_page_regions(self) -> None:
        boundaries = [Boundary("1", 0, 80, "geometry"), Boundary("2", 2, 120, "geometry")]
        regions = build_regions(boundaries, [800, 800, 800])
        self.assertEqual([region.page_index for region in regions[0]], [0, 1, 2])
        self.assertTrue(regions[0][-1].shared_page)
        self.assertEqual(regions[1][0].page_index, 2)

    def test_geometry_boundary_detection_ignores_central_page_number(self) -> None:
        words = [[
            {"text": "1.", "x0": 45, "top": 90},
            {"text": "12", "x0": 290, "top": 780},
            {"text": "2.", "x0": 45, "top": 400},
        ]]
        boundaries = detect_question_boundaries(["1. Start\n2. Next"], words, [595], [842])
        self.assertEqual([item.question_number for item in boundaries], ["1", "2"])

    def test_option_prefixed_question_sequence_is_detected(self) -> None:
        words = [[
            {"text": "E1.", "x0": 40, "top": 90},
            {"text": "E2.", "x0": 40, "top": 420},
        ]]
        boundaries = detect_question_boundaries(["E1. Start\nE2. Next"], words, [595], [842])
        self.assertEqual([item.question_number for item in boundaries], ["E1", "E2"])

    def test_compiled_mcq_is_cropped_between_main_numbers(self) -> None:
        pages = [{
            "width": 595.0, "height": 842.0, "text": "22. Previous\n23. Target A B C D\n24. Next",
            "words": [
                {"text": "22.", "x0": 40, "top": 80, "fontname": "Bold", "size": 10},
                {"text": "Previous", "x0": 72, "top": 80, "fontname": "Regular", "size": 10},
                {"text": "23.", "x0": 40, "top": 280, "fontname": "Bold", "size": 10},
                {"text": "Target", "x0": 72, "top": 280, "fontname": "Regular", "size": 10},
                {"text": "24.", "x0": 40, "top": 520, "fontname": "Bold", "size": 10},
                {"text": "Next", "x0": 72, "top": 520, "fontname": "Regular", "size": 10},
            ],
        }]
        regions, confidence, review, _ = detect_regions(pages, 0, 1, "23")
        self.assertEqual(len(regions), 1)
        self.assertLess(regions[0].y0, 280)
        self.assertLess(regions[0].y1, 520)
        self.assertGreaterEqual(confidence, 0.9)
        self.assertFalse(review)

    def test_option_label_and_repeated_continuation_number_stay_together(self) -> None:
        pages = [
            {"width": 595.0, "height": 842.0, "text": "OPTION E\n1. Start\ncontinues on the following page", "words": [
                {"text": "1.", "x0": 40, "top": 120, "fontname": "Bold", "size": 10},
                {"text": "Start", "x0": 72, "top": 120, "fontname": "Regular", "size": 10},
            ]},
            {"width": 595.0, "height": 842.0, "text": "Question 1 continued\n(a) More\n2. Next", "words": [
                {"text": "1", "x0": 40, "top": 60, "fontname": "Bold", "size": 10},
                {"text": "continued", "x0": 72, "top": 60, "fontname": "Regular", "size": 10},
                {"text": "2.", "x0": 40, "top": 600, "fontname": "Bold", "size": 10},
                {"text": "Next", "x0": 72, "top": 600, "fontname": "Regular", "size": 10},
            ]},
        ]
        regions, _, _, _ = detect_regions(pages, 0, 2, "E1")
        self.assertEqual([region.page for region in regions], [0, 1])
        self.assertGreater(regions[-1].y1, 500)

    def test_header_only_sliver_before_next_question_is_omitted(self) -> None:
        pages = [
            {"width": 595.0, "height": 842.0, "text": "1. Start", "words": [
                {"text": "1.", "x0": 40, "top": 100, "fontname": "Bold", "size": 10},
                {"text": "Start", "x0": 72, "top": 100, "fontname": "Regular", "size": 10},
            ]},
            {"width": 595.0, "height": 842.0, "text": "2. Next", "words": [
                {"text": "2.", "x0": 40, "top": 70, "fontname": "Bold", "size": 10},
                {"text": "Next", "x0": 72, "top": 70, "fontname": "Regular", "size": 10},
            ]},
        ]
        regions, _, _, _ = detect_regions(pages, 0, 2, "1")
        self.assertEqual([region.page for region in regions], [0])

    def test_reference_metadata_retains_option_and_timezone(self) -> None:
        metadata = _reference_metadata(Path("2019_May_P3_TZ2_QH3.pdf"))
        self.assertEqual((metadata["year"], metadata["timezone"], metadata["section"], metadata["label"]), (2019, 2, "H", "H3"))

    def test_manual_boundary_override_uses_persistent_coordinates(self) -> None:
        pages = [{"width": 595.0, "height": 842.0}]
        override = [{
            "source_file": "sample.pdf", "question_id": "q1",
            "regions": [{"page": 1, "y0": 100, "y1": 700}], "note": "include diagram",
        }]
        regions, matched = _apply_override("q1", "ref.pdf", override, pages)
        self.assertEqual((regions[0].y0, regions[0].y1), (100, 700))
        self.assertEqual(matched["note"], "include diagram")

    def test_lossless_crop_keeps_original_content_stream(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source.pdf"
            pdf = canvas.Canvas(str(source), invariant=1)
            pdf.drawString(40, 760, "1. Vector text and diagram")
            pdf.rect(40, 500, 180, 100)
            pdf.save()
            destination = root / "slice.pdf"
            source_reader = PdfReader(str(source))
            original = source_reader.pages[0].get_contents().get_data()
            write_slice(source, [Region(0, 0, 60, 595, 780, "cropped")], destination)
            sliced = PdfReader(str(destination)).pages[0].get_contents().get_data()
            self.assertEqual(hashlib.sha256(original).hexdigest(), hashlib.sha256(sliced).hexdigest())


class TaxonomyAndClassificationTests(unittest.TestCase):
    def test_all_taxonomies_validate(self) -> None:
        for filename in ("chemistry.json", "physics.json", "biology.json", "mathematics_aa.json", "mathematics_ai.json", "business.json", "economics.json", "computer_science.json"):
            data = json.loads((REPO_ROOT / "config" / "curricula" / filename).read_text(encoding="utf-8"))
            self.assertEqual(validate_taxonomy(data), [], filename)

    def test_classification_response_validation(self) -> None:
        taxonomy = load_taxonomy(REPO_ROOT / "config" / "curricula", "physics")
        errors = validate_classification_result(
            {"primary_topic": "NOT REAL", "secondary_topics": [], "confidence": 1.5}, taxonomy
        )
        self.assertGreaterEqual(len(errors), 2)

    def test_multi_topic_primary_and_secondary_assignment(self) -> None:
        taxonomy = load_taxonomy(REPO_ROOT / "config" / "curricula", "physics")
        question = make_question(
            "multi",
            "velocity acceleration kinematics displacement work done kinetic energy power energy conservation",
        )
        classify_question(question, taxonomy, 0.5, {})
        self.assertEqual(question.primary_topic, "A.1")
        self.assertIn("A.3", question.secondary_topics)

    def test_keyword_matching_does_not_match_inside_another_word(self) -> None:
        taxonomy = load_taxonomy(REPO_ROOT / "config" / "curricula", "mathematics", "ai")
        question = make_question("model_not_mode", "A mathematical model has a limiting value.")
        question.subject = "mathematics"
        question.course = "ai"
        question.level = "HL"
        classify_question(question, taxonomy, 0.0, {})
        self.assertNotIn("AI 4.3", question.matched_evidence)

    def test_deterministic_question_ordering(self) -> None:
        older = make_question("older", "text", year=2019)
        newer = make_question("newer", "text", year=2021)
        self.assertEqual([item.question_id for item in sorted([newer, older], key=lambda item: item.order_key())], ["older", "newer"])

    def test_legacy_master_name_maps_to_current_biology_topic(self) -> None:
        taxonomy = load_taxonomy(REPO_ROOT / "config" / "curricula", "biology")
        priors = topic_priors(["Topic 1 Cell biology / 1.4 Membrane transport"], taxonomy)
        self.assertIn("B2.1", priors)

    def test_math_source_compilation_provides_detailed_candidates(self) -> None:
        candidates = math_source_candidates(["Topic 5 Calculus / 5.2 Integral calculus"])
        self.assertEqual(candidates, {"AA 5.5", "AA 5.10", "AA 5.11"})

    def test_math_content_overrides_incorrect_legacy_compilation(self) -> None:
        taxonomy = load_taxonomy(REPO_ROOT / "config" / "curricula", "mathematics", "aa")
        question = make_question("math_wrong_legacy_hint", "Find the roots of a complex number using de Moivre's theorem.")
        question.subject = "mathematics"
        question.course = "aa"
        question.level = "HL"
        classify_with_priors(
            question,
            taxonomy,
            ["Topic 2 Functions / 2.1 Linear and quadratic functions"],
            0.80,
        )
        self.assertEqual(question.primary_topic, "AA 1.14")
        self.assertEqual(question.classification_method, "content_rules_over_legacy_compilation")

    def test_math_taxonomy_uses_all_official_2021_syllabus_statements(self) -> None:
        taxonomy = load_taxonomy(REPO_ROOT / "config" / "curricula", "mathematics", "aa")
        self.assertEqual(len(taxonomy.topics), 83)
        self.assertEqual(taxonomy.topics[0]["code"], "AA 1.1")
        self.assertEqual(taxonomy.topics[-1]["code"], "AA 5.19")

    def test_math_ai_taxonomy_uses_all_official_2021_syllabus_statements(self) -> None:
        taxonomy = load_taxonomy(REPO_ROOT / "config" / "curricula", "mathematics", "ai")
        self.assertEqual(len(taxonomy.topics), 78)
        self.assertEqual(taxonomy.topics[0]["code"], "AI 1.1")
        self.assertEqual(taxonomy.topics[-1]["code"], "AI 5.18")

    def test_computer_science_taxonomy_uses_current_2027_topics(self) -> None:
        taxonomy = load_taxonomy(REPO_ROOT / "config" / "curricula", "computer_science")
        self.assertEqual([topic["code"] for topic in taxonomy.topics], [
            "CS A.1", "CS A.2", "CS A.3", "CS A.4",
            "CS B.1", "CS B.2", "CS B.3", "CS B.4",
        ])

    def test_legacy_computer_science_paper_two_options_scope_current_topics(self) -> None:
        question = make_question("cs_option_database", "database normalization and primary keys")
        question.subject = "computer_science"
        question.paper = "P2"
        question.question_number = "2"
        self.assertEqual(_classification_scope(question), {"CS A.3"})
        question.question_number = "10"
        self.assertEqual(_classification_scope(question), {"CS A.2"})
        question.question_number = "15"
        self.assertEqual(_classification_scope(question), {"CS B.2", "CS B.3", "CS B.4"})

    def test_legacy_computer_science_option_fallback_is_deterministic(self) -> None:
        question = make_question("cs_option_web", "A context-only legacy option question")
        question.subject = "computer_science"
        question.paper = "P2"
        question.question_number = "10"
        _apply_computer_science_option_fallback(question)
        self.assertEqual(question.primary_topic, "CS A.2")
        self.assertEqual(question.status, "included")
        self.assertFalse(question.review_required)

    def test_manual_override_can_resolve_false_duplicate_candidate(self) -> None:
        taxonomy = load_taxonomy(REPO_ROOT / "config" / "curricula", "mathematics", "aa")
        question = make_question("distinct_timezone_question", "Different derivative order in the timezone variant.")
        question.subject = "mathematics"
        question.course = "aa"
        question.level = "HL"
        classify_question(question, taxonomy, 0.8, {
            question.question_id: {
                "primary_topic": "AA 5.6",
                "secondary_topics": [],
                "duplicate_status": "related_but_distinct",
            }
        })
        self.assertEqual(question.duplicate_status, "related_but_distinct")
        self.assertFalse(question.review_required)

    def test_page_fingerprint_uses_actual_content_stream(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "pages.pdf"
            pdf = canvas.Canvas(str(path), invariant=1)
            pdf.drawString(40, 760, "first")
            pdf.showPage()
            pdf.drawString(40, 760, "second")
            pdf.save()
            pages = PdfReader(str(path)).pages
            self.assertNotEqual(page_fingerprint(pages[0]), page_fingerprint(pages[1]))


class DuplicateTests(unittest.TestCase):
    def test_exact_duplicate_is_suppressed(self) -> None:
        left = make_question("left", "same complete question text about force and momentum")
        right = make_question("right", "same complete question text about force and momentum", 2021)
        left.pdf_hash = right.pdf_hash = "identical"
        left.status = right.status = "included"
        mark_duplicates([left, right])
        self.assertEqual(right.status, "exact_duplicate")
        self.assertEqual(right.duplicate_of, "left")

    def test_similar_but_distinct_is_not_auto_suppressed(self) -> None:
        base = "A long question asks the candidate to calculate velocity force momentum and energy "
        left = make_question("left", base + "for a trolley moving east.")
        right = make_question("right", base + "for a satellite moving north.", 2021)
        left.status = right.status = "included"
        mark_duplicates([left, right], likely_threshold=0.90)
        self.assertNotEqual(left.status, "exact_duplicate")
        self.assertNotEqual(right.status, "exact_duplicate")


class SafetyAndAccountingTests(unittest.TestCase):
    def test_local_guard_blocks_production_and_remote_commands(self) -> None:
        with self.assertRaises(LocalOnlyViolation):
            assert_local_only(REPO_ROOT, REPO_ROOT / "Content" / "generated")
        with self.assertRaises(LocalOnlyViolation):
            assert_safe_process(["wrangler", "r2", "object", "put", "x"])

    def test_coverage_invariant(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp)
            questions = [make_question(f"q{index}", "text") for index in range(5)]
            statuses = ["included", "exact_duplicate", "awaiting_review", "intentionally_excluded", "extraction_failure"]
            for question, status in zip(questions, statuses):
                question.status = status
            summary = write_reports(output, [], questions, [], [], [], False)
            self.assertTrue(summary["coverage_invariant"]["holds"])


class EndToEndTests(unittest.TestCase):
    def test_dry_run_writes_no_pdfs(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = create_sample(root / "source")
            output = root / "dry-output"
            options = PipelineOptions(
                repo_root=REPO_ROOT,
                output_dir=output,
                cache_dir=root / "cache",
                subjects=["physics"],
                source_dir=source,
                dry_run=True,
                confidence_threshold=0.55,
            )
            summary = run_pipeline(options)
            self.assertEqual(summary["mode"], "dry-run")
            self.assertEqual(list(output.rglob("*.pdf")), [])

    def test_controlled_local_sample(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = create_sample(root / "source")
            output = root / "output"
            cache = root / "cache"
            options = PipelineOptions(
                repo_root=REPO_ROOT,
                output_dir=output,
                cache_dir=cache,
                subjects=["physics"],
                source_dir=source,
                confidence_threshold=0.55,
            )
            summary = run_pipeline(options)
            self.assertEqual(summary["papers_processed"], 2)
            self.assertEqual(summary["papers_skipped"], 1)
            self.assertTrue(summary["coverage_invariant"]["holds"])
            self.assertGreaterEqual(summary["candidate_questions_discovered"], 4)
            masters = list(output.rglob("master.pdf"))
            self.assertTrue(masters)
            for master in masters:
                self.assertGreater(len(PdfReader(str(master)).pages), 0)
            inventory = list(csv_row for csv_row in (output / "reports" / "source_inventory.csv").read_text(encoding="utf-8-sig").splitlines())
            self.assertGreaterEqual(len(inventory), 4)

    def test_failed_text_extraction_is_reported(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            session = root / "2020 May Examination Session"
            session.mkdir(parents=True)
            blank = session / "Physics_paper_2_HL.pdf"
            pdf = canvas.Canvas(str(blank), invariant=1)
            pdf.rect(20, 20, 100, 100)
            pdf.save()
            paper = inventory_sources(REPO_ROOT, ["physics"], source_dir=root)[0]
            questions, failure = extract_questions(paper, root / "out", root / "cache")
            self.assertEqual(questions, [])
            self.assertIn("OCR", failure or "")


if __name__ == "__main__":
    unittest.main()
