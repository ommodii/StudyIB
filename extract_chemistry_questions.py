#!/usr/bin/env python3
"""
extract_chemistry_questions.py — IB Chemistry HL Question Extractor

Scans all HL Paper 1 and Paper 2 PDFs in Chemistry_HL from 2000–2022, detects individual
questions, classifies them into the 2023 Chemistry syllabus units using keyword matching,
extracts matched questions as separate PDF snippets, and generates chemistry_practice_data.js.
"""

import os
import re
import json
import shutil
from pypdf import PdfReader, PdfWriter
from collections import defaultdict

# ─── Configuration ───────────────────────────────────────────────────────────

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
HL_DIR = os.path.join(BASE_DIR, "Content", "Exam_Papers", "IB_Chemistry")
OUTPUT_DIR = os.path.join(BASE_DIR, "Content", "Extracted_Questions_Chemistry")
PRACTICE_DATA_FILE = os.path.join(BASE_DIR, "chemistry_practice_data.js")

YEAR_RANGE = range(2000, 2023)  # 2000–2022 inclusive

# ─── Topic Definitions ──────────────────────────────────────────────────────

TOPICS = {
    "Structure 1. Models of the particulate nature of matter": {
        "1.1 Introduction to the particulate nature of matter": [
            r"particulate nature", r"states of matter", r"physical change",
            r"chemical change", r"\bmixture\b", r"homogeneous", r"heterogeneous"
        ],
        "1.2 The nuclear atom": [
            r"nuclear atom", r"isotopes?", r"\bproton\b", r"\bneutron\b",
            r"mass spectrometer", r"relative atomic mass", r"isotopic abundance", r"\bnuclide\b"
        ],
        "1.3 Electron configurations": [
            r"electron configuration", r"\borbitals?\b", r"subshells?", r"ionization energy",
            r"ionisation energy", r"emission spectr", r"energy levels?", r"hund's", r"pauli", r"aufbau"
        ],
        "1.4 Counting particles by mass: The mole": [
            r"\bmole\b", r"\bmoles\b", r"avogadro", r"molar mass", r"empirical formula",
            r"molecular formula", r"stoichiometric"
        ],
        "1.5 Ideal gases": [
            r"ideal gas", r"real gas", r"gas law", r"\bboyle\b", r"charles's",
            r"pv\s*=\s*nrt", r"molar volume"
        ]
    },
    "Structure 2. Models of bonding and structure": {
        "2.1 The ionic model": [
            r"ionic bond", r"ionic model", r"ionic lattice", r"lattice enthalpy", r"electrostatic attraction"
        ],
        "2.2 The covalent model": [
            r"covalent", r"lewis structure", r"vsepr", r"molecular geometry", r"dipole moment",
            r"resonance hybrid", r"hybridiz", r"hybridis", r"dative bond", r"coordinate bond"
        ],
        "2.3 The metallic model": [
            r"metallic bond", r"delocalized electron", r"\balloy\b", r"metallic model"
        ],
        "2.4 From models to materials": [
            r"intermolecular force", r"london dispersion", r"dipole-dipole", r"hydrogen bond",
            r"allotrope", r"giant covalent", r"melting point"
        ]
    },
    "Structure 3. Classification of matter": {
        "3.1 The periodic table: Classification of elements": [
            r"periodic table", r"alkali metal", r"\bhalogen\b", r"transition metal",
            r"atomic radius", r"ionic radius", r"electronegativity", r"electron affinity", r"periodicity"
        ],
        "3.2 Functional groups: Classification of organic compounds": [
            r"homologous series", r"functional groups?", r"\balkane\b", r"\balkene\b", r"\balkyne\b",
            r"\balcohol\b", r"\bether\b", r"aldehyde", r"ketone", r"carboxylic acid", r"\bester\b",
            r"\bamine\b", r"\bamide\b", r"iupac"
        ]
    },
    "Reactivity 1. What drives chemical reactions?": {
        "1.1 Measuring enthalpy change": [
            r"enthalpy change", r"calorimetry", r"specific heat capacity", r"hess's law"
        ],
        "1.2 Energy cycles in reactions": [
            r"born-haber", r"lattice enthalpy", r"hydration enthalpy", r"solution enthalpy"
        ],
        "1.3 Energy from fuels": [
            r"enthalpy of combustion", r"bond enthalpy", r"bond enthalpies"
        ],
        "1.4 Entropy and spontaneity (AHL)": [
            r"\bentropy\b", r"gibbs", r"spontaneity", r"spontaneous"
        ]
    },
    "Reactivity 2. How much, how fast and how far?": {
        "2.1 How much? The amount of chemical change": [
            r"limiting reactant", r"percentage yield", r"percent yield", r"titration", r"concentration"
        ],
        "2.2 How fast? The rate of chemical change": [
            r"rate of reaction", r"rate equation", r"rate expression", r"order of reaction",
            r"rate constant", r"activation energy", r"reaction mechanism", r"catalyst"
        ],
        "2.3 How far? The extent of chemical change": [
            r"equilibrium", r"kc", r"le chatelier", r"reaction quotient", r"\bkp\b"
        ]
    },
    "Reactivity 3. What are the mechanisms of chemical change?": {
        "3.1 Proton transfer reactions": [
            r"bronsted-lowry", r"\bph\b", r"weak acid", r"weak base", r"buffer solution",
            r"acid-base indicator", r"\bka\b", r"\bkb\b", r"\bkw\b"
        ],
        "3.2 Electron transfer reactions": [
            r"redox", r"oxidation state", r"oxidation number", r"voltaic cell",
            r"electrolytic cell", r"electrolysis", r"winkler"
        ],
        "3.3 Electron sharing reactions": [
            r"free radicals?", r"homolytic", r"heterolytic", r"nucleophil",
            r"electrophil", r"substitution reaction", r"addition reaction", r"elimination reaction"
        ],
        "3.4 Electron-pair sharing reactions": [
            r"lewis acid", r"lewis base", r"complex ion", r"ligand"
        ]
    }
}

# ─── Question Detection ─────────────────────────────────────────────────────

def detect_paper_type(filepath):
    basename = os.path.basename(filepath).lower()
    if "paper_1" in basename:
        return "P1"
    elif "paper_2" in basename:
        return "P2"
    elif "paper_3" in basename:
        return "P3"
    return None

def extract_questions_p1(reader):
    questions = []
    page_texts = []
    
    for page in reader.pages:
        text = page.extract_text() or ""
        page_texts.append(text)
        
    question_pages = {}
    for page_idx, text in enumerate(page_texts):
        matches = re.findall(r'(?:^|\n)\s*(\d{1,2})\.\s+', text)
        for m in matches:
            qnum = int(m)
            if 1 <= qnum <= 60:
                if qnum not in question_pages:
                    question_pages[qnum] = set()
                question_pages[qnum].add(page_idx)
                
    sorted_qnums = sorted(question_pages.keys())
    for i, qnum in enumerate(sorted_qnums):
        pages = question_pages[qnum]
        start_page = min(pages)
        if i + 1 < len(sorted_qnums):
            next_q_start = min(question_pages[sorted_qnums[i + 1]])
            end_page = max(max(pages), next_q_start - 1) if next_q_start > start_page else start_page
        else:
            end_page = max(pages)
            
        end_page = max(end_page, start_page)
        
        q_text = ""
        for p in range(start_page, end_page + 1):
            q_text += page_texts[p] + "\n"
            
        combined = q_text
        pattern_start = rf'(?:^|\n)\s*{qnum}\.\s+'
        match_start = re.search(pattern_start, combined)
        if match_start:
            text_from_q = combined[match_start.start():]
            next_q = qnum + 1
            pattern_end = rf'(?:^|\n)\s*{next_q}\.\s+'
            match_end = re.search(pattern_end, text_from_q[1:])
            if match_end:
                text_from_q = text_from_q[:match_end.start() + 1]
            q_text = text_from_q
            
        questions.append({
            "qnum": qnum,
            "start_page": start_page,
            "end_page": end_page,
            "text": q_text,
        })
    return questions

def extract_questions_p2(reader):
    questions = []
    page_texts = []
    for page in reader.pages:
        text = page.extract_text() or ""
        page_texts.append(text)
        
    # Detect where the formula booklet or periodic table starts to avoid capturing it in the last question
    formula_start = len(page_texts)
    for idx, text in enumerate(page_texts):
        if re.search(r'(?i)(formula booklet|data booklet|periodic table|statistical tables|list of formulae)', text):
            if idx > len(page_texts) * 0.5:
                formula_start = idx
                break

    question_first_page = {}
    for page_idx, text in enumerate(page_texts):
        # Match any option prefix letter (like E1. or A1. or 1.) at start of a logical line
        pattern = r'(?:^|\n)\s*([A-Z]?\d{1,2})\.\s+(?![0-9])(?:[A-Z]|\([a-z]\))'
        matches = re.findall(pattern, text)
        for m in matches:
            q_label = m.strip()
            if q_label not in question_first_page:
                question_first_page[q_label] = page_idx
                
    sorted_qs = sorted(question_first_page.items(), key=lambda x: x[1])
    for i, (q_label, first_page) in enumerate(sorted_qs):
        if i + 1 < len(sorted_qs):
            next_first_page = sorted_qs[i + 1][1]
            end_page = next_first_page - 1
        else:
            end_page = min(len(page_texts) - 1, formula_start - 1)
        end_page = max(end_page, first_page)
        
        q_text = ""
        for p in range(first_page, end_page + 1):
            q_text += page_texts[p] + "\n"
            
        questions.append({
            "qnum": q_label,
            "start_page": first_page,
            "end_page": end_page,
            "text": q_text,
        })
    return questions

# ─── Classification ──────────────────────────────────────────────────────────

def classify_question(text):
    text_lower = text.lower()
    best_match = None
    best_score = 0
    
    for category, subtopics in TOPICS.items():
        for subtopic, keywords in subtopics.items():
            score = 0
            for kw in keywords:
                if re.search(kw, text_lower):
                    score += 1
            if score > best_score:
                best_score = score
                best_match = (category, subtopic)
                
    if best_score >= 1:
        return best_match
    return None

# ─── PDF Extraction ──────────────────────────────────────────────────────────

def extract_pages_to_pdf(reader, start_page, end_page, output_path):
    writer = PdfWriter()
    for i in range(start_page, end_page + 1):
        writer.add_page(reader.pages[i])
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "wb") as f:
        writer.write(f)

def parse_session_info(session_name, filename):
    parts = session_name.split()
    year = parts[0]
    month = parts[1]
    tz_match = re.search(r'TZ(\d)', filename)
    tz = f"TZ{tz_match.group(1)}" if tz_match else ""
    paper_match = re.search(r'paper_(\d)', filename)
    paper = f"P{paper_match.group(1)}" if paper_match else "P?"
    return year, month, tz, paper

def get_chemistry_full_papers():
    HL_DIR_PATH = Path(HL_DIR)
    full_papers = {}
    if HL_DIR_PATH.exists():
        for root, dirs, files in os.walk(HL_DIR_PATH):
            session_folder = Path(root).name
            match = re.search(r'^(\d{4})\s+(May|November|Nov)', session_folder, re.IGNORECASE)
            if not match:
                continue
                
            year = match.group(1)
            session = match.group(2).capitalize()
            if session == 'Nov':
                session = 'November'
            
            if year not in full_papers:
                full_papers[year] = {}
            if session not in full_papers[year]:
                full_papers[year][session] = []
                
            pdfs = [f for f in files if f.lower().endswith('.pdf') and 'french' not in f.lower() and 'spanish' not in f.lower()]
            
            paper_groups = {}
            for pdf in pdfs:
                base = re.sub(r'(?i)_?markscheme\.pdf$', '.pdf', pdf.lower())
                
                if base not in paper_groups:
                    paper_groups[base] = {"qp": None, "ms": None, "original_name": ""}
                
                full_path = Path(root) / pdf
                file_path = os.path.relpath(full_path, BASE_DIR).replace(os.sep, '/')
                
                if "markscheme" in pdf.lower():
                    paper_groups[base]["ms"] = file_path
                else:
                    paper_groups[base]["qp"] = file_path
                    paper_groups[base]["original_name"] = pdf.replace(".pdf", "")
            
            for base, group in paper_groups.items():
                if group["qp"]:
                    name = group["original_name"]
                    display_name = re.sub(r'(?i)^chemistry_', '', name).replace('_', ' ').replace('  ', ' ').title()
                    full_papers[year][session].append({
                        "name": display_name,
                        "qp_path": group["qp"],
                        "ms_path": group["ms"]
                    })
    
    sorted_full_papers = {}
    for year in sorted(full_papers.keys(), reverse=True):
        sorted_full_papers[year] = {}
        for session in ["May", "November"]:
            if session in full_papers[year]:
                sorted_full_papers[year][session] = sorted(full_papers[year][session], key=lambda x: x["name"])
    return sorted_full_papers

# ─── Main ───────────────────────────────────────────────────────────────────

from pathlib import Path

def main():
    print("=" * 70)
    print("IB Chemistry HL Question Extractor")
    print("=" * 70)
    
    # Reset output directory to clear out previous messy files
    if os.path.exists(OUTPUT_DIR):
        print(f"Clearing old files from {OUTPUT_DIR}...")
        shutil.rmtree(OUTPUT_DIR, ignore_errors=True)
    
    pdf_files = []
    for session_name in sorted(os.listdir(HL_DIR)):
        session_path = os.path.join(HL_DIR, session_name)
        if not os.path.isdir(session_path):
            continue
            
        year_match = re.match(r"(\d{4})", session_name)
        if not year_match:
            continue
        year = int(year_match.group(1))
        if year not in YEAR_RANGE:
            continue
            
        for fname in sorted(os.listdir(session_path)):
            if not fname.endswith(".pdf") or "markscheme" in fname.lower() or "french" in fname.lower() or "spanish" in fname.lower():
                continue
                
            fpath = os.path.join(session_path, fname)
            paper_type = detect_paper_type(fpath)
            if paper_type in ("P1", "P2", "P3"):
                pdf_files.append((session_name, fname, fpath, paper_type))
                
    print(f"\nFound {len(pdf_files)} papers to scan.\n")
    
    practice_data = defaultdict(lambda: defaultdict(list))
    stats = {
        "papers_scanned": 0,
        "questions_found": 0,
        "questions_classified": 0,
        "questions_per_topic": defaultdict(lambda: defaultdict(int)),
        "errors": []
    }
    
    for session_name, fname, fpath, paper_type in pdf_files:
        year, month, tz, paper = parse_session_info(session_name, fname)
        source_label = f"{year} {month} {paper}"
        if tz:
            source_label += f" {tz}"
            
        print(f"  Scanning: {source_label} ({paper_type})...")
        
        try:
            reader = PdfReader(fpath)
            stats["papers_scanned"] += 1
            questions = extract_questions_p1(reader) if paper_type == "P1" else extract_questions_p2(reader)
            stats["questions_found"] += len(questions)
            
            for q in questions:
                classification = classify_question(q["text"])
                if classification is None:
                    continue
                    
                category, subtopic = classification
                stats["questions_classified"] += 1
                stats["questions_per_topic"][category][subtopic] += 1
                
                qnum_str = str(q["qnum"]).replace(".", "")
                safe_tz = f"_{tz}" if tz else ""
                out_filename = f"{year}_{month}_{paper}{safe_tz}_Q{qnum_str}.pdf"
                
                # Sanitize directory names to remove illegal characters for Windows (e.g. "?", ":")
                safe_category = re.sub(r'[\/\\\:\*\?\"\<\>\|]', '', category)
                safe_subtopic = re.sub(r'[\/\\\:\*\?\"\<\>\|]', '', subtopic)
                out_path = os.path.join(OUTPUT_DIR, safe_category, safe_subtopic, out_filename)
                
                extract_pages_to_pdf(reader, q["start_page"], q["end_page"], out_path)
                
                rel_path = os.path.relpath(out_path, BASE_DIR).replace(os.sep, '/')
                full_paper_rel = os.path.relpath(fpath, BASE_DIR).replace(os.sep, '/')
                
                practice_data[category][subtopic].append({
                    "filename": out_filename,
                    "filepath": rel_path,
                    "source": source_label,
                    "qnum": str(q["qnum"]),
                    "paper_type": paper_type,
                    "full_paper_path": full_paper_rel,
                    "pages": f"{q['start_page'] + 1}-{q['end_page'] + 1}",
                })
        except Exception as e:
            print(f"    ERROR: {e}")
            stats["errors"].append(f"{source_label}: {e}")
            
    # Sort practice questions
    for category in practice_data:
        for subtopic in practice_data[category]:
            practice_data[category][subtopic].sort(key=lambda x: x["filename"])
            
    # ─── Merge Topic Questions into Compiled PDFs ──────────────────────────────
    print("\nMerging individual questions into Full Topic Past Papers...")
    
    SORTED_TOPICS_DIR = os.path.join(BASE_DIR, "Content", "Sorted_Topics_Chemistry")
    if os.path.exists(SORTED_TOPICS_DIR):
        shutil.rmtree(SORTED_TOPICS_DIR, ignore_errors=True)
    os.makedirs(SORTED_TOPICS_DIR, exist_ok=True)
    
    syllabus_data = defaultdict(lambda: defaultdict(list))
    
    for category, subtopics in practice_data.items():
        safe_category = re.sub(r'[\/\\\:\*\?\"\<\>\|]', '', category)
        category_dir = os.path.join(SORTED_TOPICS_DIR, safe_category)
        os.makedirs(category_dir, exist_ok=True)
        
        for subtopic, questions in subtopics.items():
            if not questions:
                continue
            
            safe_subtopic = re.sub(r'[\/\\\:\*\?\"\<\>\|]', '', subtopic)
            merged_filename = f"{safe_subtopic}.pdf"
            merged_path = os.path.join(category_dir, merged_filename)
            
            # Merge all individual question PDFs
            writer = PdfWriter()
            for q in questions:
                q_abs_path = os.path.join(BASE_DIR, q["filepath"])
                if os.path.exists(q_abs_path):
                    writer.append(q_abs_path)
            
            with open(merged_path, "wb") as f:
                writer.write(f)
            writer.close()
            
            # Save the relative path for frontend
            rel_merged_path = os.path.relpath(merged_path, BASE_DIR).replace(os.sep, '/')
            syllabus_data[category][subtopic].append({
                "filename": merged_filename,
                "filepath": rel_merged_path
            })

    # Sort outputs
    output_practice = {}
    for category in sorted(practice_data.keys()):
        output_practice[category] = {}
        for subtopic in sorted(practice_data[category].keys()):
            output_practice[category][subtopic] = practice_data[category][subtopic]
            
    output_syllabus = {}
    for category in sorted(syllabus_data.keys()):
        output_syllabus[category] = {}
        for subtopic in sorted(syllabus_data[category].keys()):
            output_syllabus[category][subtopic] = syllabus_data[category][subtopic]

    # Load Full Papers
    full_papers = get_chemistry_full_papers()

    # Overwrite chemistry_data.js with ONLY full papers data to prevent duplicate declarations
    data_js_path = os.path.join(BASE_DIR, "chemistry_data.js")
    data_js_content = (
        f"const chemistryFullPapersData = {json.dumps(full_papers, indent=2)};\n"
    )
    with open(data_js_path, "w", encoding="utf-8") as f:
        f.write(data_js_content)
        
    # Overwrite chemistry_practice_data.js with practice and syllabus topic data
    with open(PRACTICE_DATA_FILE, "w", encoding="utf-8") as f:
        f.write(
            f"const chemistryPracticeData = {json.dumps(output_practice, indent=2)};\n\n"
            f"const chemistrySyllabusData = {json.dumps(output_syllabus, indent=2)};\n"
        )
        
    print("\n" + "=" * 70)
    print("EXTRACTION COMPLETE")
    print("=" * 70)
    print(f"  Papers scanned:       {stats['papers_scanned']}")
    print(f"  Total questions found: {stats['questions_found']}")
    print(f"  Questions classified:  {stats['questions_classified']}")
    print(f"  Merged topic papers:  {len(output_syllabus)}")
    
if __name__ == "__main__":
    main()
