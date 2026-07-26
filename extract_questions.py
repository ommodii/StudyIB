#!/usr/bin/env python3
"""
extract_questions.py — IB Physics HL Question Extractor

Scans all HL Paper 1, Paper 2, and Paper 3 PDFs in Exam_Papers/IB_Physics from 2000–2022,
detects individual questions, classifies them into the core IB Physics syllabus topics
and Paper 3 options using keyword matching, extracts matched questions as separate PDF
snippets, compiles them into merged topic past papers, and generates data.js and practice_data.js.
"""

import os
import re
import json
import shutil
from pypdf import PdfReader, PdfWriter
from collections import defaultdict
from pathlib import Path

# ─── Configuration ───────────────────────────────────────────────────────────

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
HL_DIR = os.path.join(BASE_DIR, "Content", "Exam_Papers", "IB_Physics")
OUTPUT_DIR = os.path.join(BASE_DIR, "Content", "Extracted_Questions")
SORTED_TOPICS_DIR = os.path.join(BASE_DIR, "Content", "Sorted_Topics")
DATA_JS_FILE = os.path.join(BASE_DIR, "data.js")
PRACTICE_DATA_FILE = os.path.join(BASE_DIR, "practice_data.js")

YEAR_RANGE = range(2000, 2026)  # 2000–2025 inclusive

# ─── Topic Definitions ──────────────────────────────────────────────────────

TOPICS = {
    "Topic 1: Measurements and Uncertainties": {
        "1.1 Measurements in physics": [
            r"si base unit", r"derived unit", r"\bbase unit\b", r"scientific notation",
            r"order of magnitude", r"fundamental unit", r"metric multiplier"
        ],
        "1.2 Uncertainties and errors": [
            r"uncertaint", r"systematic error", r"random error", r"precision",
            r"accuracy", r"absolute uncertainty", r"fractional uncertainty",
            r"percentage uncertainty", r"error bar", r"line of best fit"
        ],
        "1.3 Vectors and scalars": [
            r"scalar", r"\bvector\b(?!.*boson)", r"resultant", r"resolving vector",
            r"vector addition", r"component of a vector"
        ]
    },
    "Topic 2: Mechanics": {
        "2.1 Motion": [
            r"displacement", r"velocity", r"acceleration", r"speed", r"equation.*of motion",
            r"constant acceleration", r"velocity-time graph", r"displacement-time graph",
            r"suvat", r"free fall", r"projectile", r"terminal velocity", r"air resistance"
        ],
        "2.2 Forces": [
            r"newton's.*law", r"inertia", r"force", r"weight", r"tension", r"friction",
            r"normal reaction force", r"free-body diagram", r"translational equilibrium",
            r"drag force", r"coefficient of friction"
        ],
        "2.3 Work, energy and power": [
            r"work done", r"kinetic energy", r"gravitational potential energy",
            r"elastic potential energy", r"conservation of energy", r"efficiency",
            r"\bpower\b(?!.*nuclear)(?!.*generation)(?!.*factor)", r"spring constant", r"hooke's law"
        ],
        "2.4 Momentum and impulse": [
            r"momentum", r"impulse", r"collision", r"elastic collision", r"inelastic collision",
            r"conservation of momentum", r"recoil", r"explosion"
        ]
    },
    "Topic 3: Thermal Physics": {
        "3.1 Thermal concepts": [
            r"temperature", r"internal energy", r"specific heat capacity", r"specific latent heat",
            r"phase change", r"thermal capacity", r"conduction", r"convection", r"radiation",
            r"thermal equilibrium"
        ],
        "3.2 Modelling a gas": [
            r"ideal gas", r"real gas", r"gas law", r"\bboyle\b", r"charles's", r"gay-lussac",
            r"equation of state", r"kinetic theory", r"mole", r"avogadro", r"molar mass",
            r"boltzmann constant"
        ]
    },
    "Topic 4: Waves": {
        "4.1 Oscillations": [
            r"oscillation", r"simple harmonic motion", r"\bshm\b", r"restoring force",
            r"amplitude", r"time period", r"frequency", r"phase difference", r"angular frequency"
        ],
        "4.2 Travelling waves": [
            r"travelling wave", r"transverse wave", r"longitudinal wave", r"wavelength",
            r"wave speed", r"crest", r"trough", r"compression", r"rarefaction",
            r"electromagnetic spectrum", r"speed of light"
        ],
        "4.3 Wave characteristics": [
            r"wavefront", r"\bray\b", r"intensity", r"amplitude", r"inverse square law",
            r"superposition", r"polariz", r"polarised", r"malus"
        ],
        "4.4 Wave behaviour": [
            r"reflection", r"refraction", r"snell", r"critical angle", r"total internal reflection",
            r"diffraction", r"interference", r"constructive interference", r"destructive interference",
            r"path difference", r"double-slit"
        ],
        "4.5 Standing waves": [
            r"standing wave", r"stationary wave", r"\bnode\b", r"antinode",
            r"fundamental frequency", r"harmonic", r"open pipe", r"closed pipe",
            r"boundary condition"
        ]
    },
    "Topic 5: Electricity and Magnetism": {
        "5.1 Electric fields": [
            r"electric field", r"coulomb's law", r"point charge", r"electric potential",
            r"potential difference", r"electric force", r"permittivity"
        ],
        "5.2 Heating effect of electric currents": [
            r"electric current", r"resistance", r"resistivity", r"ohm's law", r"ohmic",
            r"non-ohmic", r"resistor", r"filament lamp", r"potential divider", r"voltmeter",
            r"ammeter", r"series circuit", r"parallel circuit", r"kirchhoff"
        ],
        "5.3 Electric cells": [
            r"electric cell", r"battery", r"\bemf\b", r"\be\.m\.f\b", r"electromotive force",
            r"internal resistance", r"terminal potential difference", r"rechargeable cell",
            r"primary cell", r"secondary cell"
        ],
        "5.4 Magnetic effects of electric currents": [
            r"magnetic field", r"magnetic force", r"magnetic flux density", r"\btesla\b",
            r"solenoid", r"current-carrying conductor", r"right-hand rule", r"lorentz force"
        ]
    },
    "Topic 6: Circular Motion and Gravitation": {
        "6.1 Circular motion": [
            r"circular motion", r"centripetal acceleration", r"centripetal force",
            r"angular velocity", r"angular speed", r"period of rotation", r"linear speed"
        ],
        "6.2 Newton’s law of gravitation": [
            r"gravitation", r"newton's law of gravitation", r"gravitational field strength",
            r"gravitational force", r"orbital speed", r"orbital motion"
        ]
    },
    "Topic 7: Atomic, Nuclear and Particle Physics": {
        "7.1 Discrete energy and radioactivity": [
            r"energy level", r"emission spectrum", r"absorption spectrum", r"photon",
            r"radioactive decay", r"alpha decay", r"beta decay", r"gamma radiation",
            r"half-life", r"ionization", r"background radiation"
        ],
        "7.2 Nuclear reactions": [
            r"binding energy", r"mass defect", r"nuclear fission", r"nuclear fusion",
            r"unified atomic mass unit", r"einstein's mass-energy equivalence", r"chain reaction"
        ],
        "7.3 The structure of matter": [
            r"quark", r"lepton", r"hadron", r"baryon", r"meson", r"feynman diagram",
            r"exchange particle", r"standard model", r"boson", r"gluon", r"neutrino",
            r"antiparticle", r"confinement"
        ]
    },
    "Topic 8: Energy Production": {
        "8.1 Energy sources": [
            r"renewable energy", r"non-renewable energy", r"fossil fuel", r"nuclear power",
            r"solar energy", r"wind energy", r"hydroelectric", r"pumped storage",
            r"photovoltaic", r"active solar", r"wind turbine", r"nuclear reactor",
            r"moderator", r"control rod", r"heat exchanger", r"energy density", r"specific energy"
        ],
        "8.2 Thermal energy transfer": [
            r"thermal conduction", r"convection", r"radiation", r"black-body radiation",
            r"albedo", r"solar constant", r"greenhouse effect", r"greenhouse gas",
            r"stefan-boltzmann", r"wien's displacement law", r"emissivity"
        ]
    },
    "Topic 9: Wave Phenomena (AHL)": {
        "9.1 Simple harmonic motion": [
            r"shm equations", r"phase angle", r"kinetic energy in shm",
            r"potential energy in shm", r"energy-displacement graph"
        ],
        "9.2 Single-slit diffraction": [
            r"single-slit diffraction", r"angular width of central maximum",
            r"first minimum", r"diffraction pattern"
        ],
        "9.3 Interference": [
            r"double-slit interference", r"multiple-slit", r"diffraction grating",
            r"thin-film interference", r"parallel plates", r"path difference in thin film",
            r"wedge interference"
        ],
        "9.4 Resolution": [
            r"rayleigh criterion", r"resolving power", r"angular resolution",
            r"diffraction limit", r"resolvability"
        ],
        "9.5 Doppler effect": [
            r"doppler effect", r"frequency shift", r"doppler shift",
            r"receding source", r"approaching source", r"redshift", r"blueshift"
        ]
    },
    "Topic 10: Fields (AHL)": {
        "10.1 Describing fields": [
            r"gravitational potential", r"electrostatic potential", r"equipotential",
            r"potential gradient", r"field line"
        ],
        "10.2 Fields at work": [
            r"escape speed", r"orbital speed", r"orbital energy",
            r"potential energy", r"work done in field"
        ]
    },
    "Topic 11: Electromagnetic Induction (AHL)": {
        "11.1 Electromagnetic induction": [
            r"electromagnetic induction", r"induced emf", r"induced e\.m\.f",
            r"faraday's law", r"lenz's law", r"magnetic flux linkage", r"change in flux"
        ],
        "11.2 Power generation and transmission": [
            r"alternating current", r"\bac\b", r"generator", r"transformer",
            r"step-up transformer", r"step-down transformer", r"rms voltage",
            r"rms current", r"rectification", r"diode bridge", r"power loss in transmission"
        ],
        "11.3 Capacitance": [
            r"capacitor", r"capacitance", r"dielectric", r"charging capacitor",
            r"discharging capacitor", r"time constant", r"\brc circuit\b",
            r"energy stored in capacitor"
        ]
    },
    "Topic 12: Quantum and Nuclear Physics (AHL)": {
        "12.1 The interaction of matter with radiation": [
            r"photoelectric effect", r"work function", r"threshold frequency",
            r"de broglie wavelength", r"bohr model", r"schrodinger", r"wave function",
            r"probability density", r"heisenberg uncertainty principle", r"tunneling"
        ],
        "12.2 Nuclear physics": [
            r"nuclear radius", r"rutherford scattering", r"closest approach",
            r"nuclear energy level", r"neutrino hypothesis", r"decay constant",
            r"activity", r"radioactive decay law"
        ]
    },
    "Paper 3 Options": {
        "Option A: Special Relativity": [
            r"special relativity", r"galilean relativity", r"postulates of special relativity",
            r"frame of reference", r"inertial frame", r"simultaneity", r"time dilation",
            r"length contraction", r"proper time", r"proper length", r"muon decay",
            r"lorentz factor", r"spacetime diagram", r"worldline", r"relativistic mechanics",
            r"rest mass", r"relativistic momentum", r"total relativistic energy",
            r"equivalence principle", r"general relativity", r"gravitational time dilation",
            r"schwarzschild radius", r"black hole"
        ],
        "Option B: Rigid Body Mechanics": [
            r"torque", r"moment of inertia", r"rotational dynamics", r"angular acceleration",
            r"angular momentum", r"rotational equilibrium", r"rotational kinetic energy",
            r"flywheel", r"angular impulse"
        ],
        "Option B: Thermodynamics": [
            r"thermodynamics", r"first law of thermodynamics", r"second law of thermodynamics",
            r"isothermal", r"adiabatic", r"isobaric", r"isochoric", r"p-v diagram",
            r"carnot cycle", r"entropy", r"heat engine", r"efficiency of engine"
        ],
        "Option C: Imaging": [
            r"thin lens", r"converging lens", r"diverging lens", r"lens formula",
            r"magnification", r"spherical aberration", r"chromatic aberration",
            r"optical instrument", r"microscope", r"telescope", r"optical fibre",
            r"total internal reflection in fibre", r"step-index", r"graded-index",
            r"attenuation", r"medical imaging", r"x-ray", r"ct scan", r"ultrasound", r"mri"
        ],
        "Option D: Astrophysics": [
            r"stellar quantities", r"luminosity", r"apparent brightness", r"wien's law",
            r"hertzsprung-russell", r"hr diagram", r"main sequence", r"cepheid variable",
            r"stellar evolution", r"white dwarf", r"neutron star", r"black hole",
            r"chandrasekhar limit", r"oppenheimer-volkoff limit", r"cosmology",
            r"hubble's law", r"cosmic microwave background", r"cmb", r"critical density",
            r"dark matter", r"dark energy", r"stellar parallax"
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

def parse_pdf_session_info(fpath, hl_dir):
    rel_path = os.path.relpath(fpath, hl_dir)
    
    # Extract year (4 digits)
    year_match = re.search(r'\b(19\d{2}|20\d{2})\b', rel_path)
    year = year_match.group(1) if year_match else "2000"
    
    # Extract month (May or November)
    month = "May"
    if re.search(r'(?i)\b(nov|november)\b', rel_path):
        month = "November"
    elif re.search(r'(?i)\b(may)\b', rel_path):
        month = "May"
        
    filename = os.path.basename(fpath)
    tz_match = re.search(r'(?i)TZ(\d)', filename)
    tz = f"TZ{tz_match.group(1)}" if tz_match else ""
    
    paper_match = re.search(r'(?i)paper_(\d)', filename)
    paper = f"P{paper_match.group(1)}" if paper_match else "P?"
    
    return year, month, tz, paper

def get_physics_full_papers():
    HL_DIR_PATH = Path(HL_DIR)
    full_papers = {}
    
    if HL_DIR_PATH.exists():
        for root, dirs, files in os.walk(HL_DIR_PATH):
            pdfs = [f for f in files if f.lower().endswith('.pdf') and 'french' not in f.lower() and 'spanish' not in f.lower()]
            if not pdfs:
                continue
                
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
                    qp_path = group["qp"]
                    year, month, tz, paper = parse_pdf_session_info(os.path.join(BASE_DIR, qp_path), HL_DIR)
                    
                    if int(year) not in YEAR_RANGE:
                        continue
                        
                    if year not in full_papers:
                        full_papers[year] = {}
                    if month not in full_papers[year]:
                        full_papers[year][month] = []
                        
                    name = group["original_name"]
                    display_name = re.sub(r'(?i)^physics_', '', name).replace('_', ' ').replace('  ', ' ').title()
                    full_papers[year][month].append({
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

def main():
    print("=" * 70)
    print("IB Physics HL Question Extractor")
    print("=" * 70)
    
    if os.path.exists(OUTPUT_DIR):
        print(f"Clearing old files from {OUTPUT_DIR}...")
        shutil.rmtree(OUTPUT_DIR, ignore_errors=True)
    if os.path.exists(SORTED_TOPICS_DIR):
        print(f"Clearing old files from {SORTED_TOPICS_DIR}...")
        shutil.rmtree(SORTED_TOPICS_DIR, ignore_errors=True)
        
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    os.makedirs(SORTED_TOPICS_DIR, exist_ok=True)
    
    pdf_files = []
    # Walk recursively to gather files
    for root, dirs, files in os.walk(HL_DIR):
        for fname in sorted(files):
            if not fname.endswith(".pdf") or "markscheme" in fname.lower() or "french" in fname.lower() or "spanish" in fname.lower():
                continue
                
            fpath = os.path.join(root, fname)
            
            # Extract year from the path to see if it's in range
            year, month, tz, paper = parse_pdf_session_info(fpath, HL_DIR)
            if int(year) not in YEAR_RANGE:
                continue
                
            paper_type = detect_paper_type(fpath)
            if paper_type in ("P1", "P2", "P3"):
                # Use a session label representing the path
                session_label = f"{year} {month} Examination Session"
                pdf_files.append((session_label, fname, fpath, paper_type))
                
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
        year, month, tz, paper = parse_pdf_session_info(fpath, HL_DIR)
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
            
            writer = PdfWriter()
            for q in questions:
                q_abs_path = os.path.join(BASE_DIR, q["filepath"])
                if os.path.exists(q_abs_path):
                    writer.append(q_abs_path)
            
            with open(merged_path, "wb") as f:
                writer.write(f)
            writer.close()
            
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
    full_papers = get_physics_full_papers()

    # Overwrite data.js with syllabus topic and full papers data
    with open(DATA_JS_FILE, "w", encoding="utf-8") as f:
        f.write(
            f"const syllabusData = {json.dumps(output_syllabus, indent=2)};\n\n"
            f"const fullPapersData = {json.dumps(full_papers, indent=2)};\n"
        )
        
    # Overwrite practice_data.js with practice topic data
    with open(PRACTICE_DATA_FILE, "w", encoding="utf-8") as f:
        f.write(
            f"const practiceData = {json.dumps(output_practice, indent=2)};\n"
        )
        
    print("\n" + "=" * 70)
    print("EXTRACTION COMPLETE")
    print("=" * 70)
    print(f"  Papers scanned:       {stats['papers_scanned']}")
    print(f"  Total questions found: {stats['questions_found']}")
    print(f"  Questions classified:  {stats['questions_classified']}")
    print(f"  Merged topic papers:  {len(output_syllabus)}")
    
    print("\nQuestions per topic:")
    for category in sorted(stats["questions_per_topic"].keys()):
        print(f"\n  {category}:")
        cat_total = 0
        for subtopic in sorted(stats["questions_per_topic"][category].keys()):
            count = stats["questions_per_topic"][category][subtopic]
            cat_total += count
            print(f"    {subtopic}: {count}")
        print(f"    --- Total: {cat_total}")
        
    if stats["errors"]:
        print(f"\nErrors ({len(stats['errors'])}):")
        for err in stats["errors"]:
            print(f"  {err}")

if __name__ == "__main__":
    main()
