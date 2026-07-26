#!/usr/bin/env python3
import os
import re
import json
import shutil
from pathlib import Path
from pypdf import PdfReader, PdfWriter

BASE_DIR = Path(__file__).parent.resolve()
PHYSICS_DIR = BASE_DIR / "Content" / "Exam_Papers" / "ALevel_Physics"
CHEMISTRY_DIR = BASE_DIR / "Content" / "Exam_Papers" / "ALevel_Chemistry"
OUTPUT_DATA_FILE = BASE_DIR / "alevel_data.js"

# --- A-Level Physics Topic Keywords ---
PHYSICS_TOPICS = {
    "1. Physical Quantities & Units": {
        "1.1 Physical quantities and units": [r"si base unit", r"derived unit", r"homogeneity", r"homogeneous equation", r"\bbase unit\b"],
        "1.2 Errors and uncertainties": [r"uncertaint", r"systematic error", r"random error", r"precision", r"accuracy"],
        "1.3 Vectors and scalars": [r"scalar", r"\bvector\b", r"resultant", r"component of a vector", r"resolving vector"]
    },
    "2. Kinematics": {
        "2.1 Equations of motion": [r"displacement", r"velocity", r"acceleration", r"speed", r"equations? of motion", r"constant acceleration", r"velocity-time graph", r"displacement-time graph"],
        "2.2 Projectile motion": [r"projectile", r"trajectory", r"vertical acceleration", r"horizontal velocity", r"air resistance"]
    },
    "3. Dynamics": {
        "3.1 Newton's laws of motion": [r"newton's.*law", r"inertia", r"rate of change of momentum", r"force", r"mass", r"weight", r"tension", r"friction", r"resistance force"],
        "3.2 Collisions and momentum": [r"collision", r"elastic collision", r"inelastic collision", r"conservation of momentum", r"impulse"]
    },
    "4. Forces, Density & Pressure": {
        "4.1 Moments and equilibrium": [r"centre of gravity", r"moment of a force", r"\bcouple\b", r"torque", r"equilibrium", r"principle of moments"],
        "4.2 Density and pressure": [r"density", r"\bpressure\b", r"upthrust", r"archimedes", r"hydrostatic pressure"]
    },
    "5. Work, Energy & Power": {
        "5.1 Work and energy": [r"work done", r"kinetic energy", r"gravitational potential energy", r"conservation of energy", r"efficiency"],
        "5.2 Power": [r"\bpower\b", r"rate of work"]
    },
    "6. Deformation of Solids": {
        "6.1 Stress and strain": [r"tensile", r"stress", r"strain", r"hooke's law", r"elastic limit", r"young modulus", r"elastic potential energy"]
    },
    "7. Waves & Superposition": {
        "7.1 Wave properties": [r"wavelength", r"frequency", r"wave speed", r"transverse", r"longitudinal", r"polarisation", r"polarized", r"wave energy"],
        "7.2 Superposition and stationary waves": [r"diffraction", r"interference", r"diffraction grating", r"coheren", r"superposition", r"double-slit", r"fringe spacing", r"stationary wave", r"node", r"antinode"]
    },
    "8. Electricity": {
        "8.2 DC circuits": [r"kirchhoff's", r"potential divider", r"series circuit", r"parallel circuit", r"potentiometer", r"circuit", r"resistor"],
        "8.1 Current and resistance": [r"electric current", r"potential difference", r"ohms? law", r"resistivity", r"internal resistance", r"e.m.f"]
    },
    "9. Circular Motion & Gravitation": {
        "9.1 Circular motion": [r"angular speed", r"centripetal acceleration", r"centripetal force", r"circular orbit"],
        "9.2 Gravitational fields": [r"gravitational field", r"newton's law of gravitation", r"gravitational potential", r"orbit.*period", r"escape velocity"]
    },
    "10. Oscillations & Thermal Physics": {
        "10.1 Simple harmonic oscillations": [r"simple harmonic", r"\bshm\b", r"damping", r"resonance", r"angular frequency"],
        "10.2 Thermal properties & ideal gases": [r"specific heat capacity", r"latent heat", r"boyle's law", r"equation of state", r"kinetic theory of gases", r"internal energy", r"first law of thermodynamics"]
    },
    "11. Electromagnetism": {
        "11.1 Electric fields and capacitance": [r"coulomb's law", r"electric potential", r"capacitance", r"capacitor", r"dielectric"],
        "11.2 Magnetic fields & induction": [r"magnetic flux", r"magnetic field strength", r"hall effect", r"electromagnetic induction", r"faraday's law", r"lenz's law", r"alternating current", r"rectification", r"transformer"]
    },
    "12. Quantum & Nuclear Physics": {
        "12.1 Quantum physics": [r"photoelectric effect", r"photon energy", r"wave-particle duality", r"line spectra", r"de broglie wavelength"],
        "12.2 Nuclear physics": [r"radioactive decay", r"half-life", r"binding energy", r"mass defect", r"fission", r"fusion", r"alpha particle", r"beta particle", r"gamma ray"]
    },
    "13. Engineering & Options": {
        "13.1 Special relativity": [r"special relativity", r"lorentz transformation", r"spacetime", r"time dilation", r"length contraction", r"equivalence principle", r"space-time"],
        "13.2 Rotational dynamics & fluid mechanics": [r"rigid body", r"moment of inertia", r"rotational dynamics", r"torque", r"angular momentum", r"rotational kinetic energy", r"flywheel", r"fluid dynamics", r"bernoulli", r"viscosity", r"reynolds"],
        "13.3 Medical physics & imaging": [r"ultrasound", r"x-ray", r"mri", r"piezoelectric", r"attenuation", r"thin lens", r"focal length", r"optical fibre"],
        "13.4 Astrophysics": [r"stellar parallax", r"cepheid variable", r"stellar magnitude", r"apparent magnitude", r"cosmology", r"hubble's law", r"dark matter", r"critical density"]
    }
}

PHYSICS_PRIORITY = [
    '13. Engineering & Options',
    '12. Quantum & Nuclear Physics',
    '11. Electromagnetism',
    '9. Circular Motion & Gravitation',
    '10. Oscillations & Thermal Physics',
    '8. Electricity',
    '7. Waves & Superposition',
    '6. Deformation of Solids',
    '5. Work, Energy & Power',
    '4. Forces, Density & Pressure',
    '1. Physical Quantities & Units',
    '3. Dynamics',
    '2. Kinematics'
]

# --- A-Level Chemistry Topic Keywords ---
CHEMISTRY_TOPICS = {
    "1. Physical Chemistry": {
        "1.1 Atoms, molecules and stoichiometry": [r"atomic mass", r"isotop", r"empirical formula", r"molecular formula", r"stoichiometr", r"excess reactant", r"limiting reactant", r"\bmole\b", r"yield"],
        "1.2 Atomic structure & bonding": [r"electron configuration", r"ionization energy", r"ionisation energy", r"covalent bond", r"ionic bond", r"vsepr", r"intermolecular force", r"hydrogen bond", r"electronegativ", r"hybridis", r"hybridiz"],
        "1.3 States of matter & ideal gases": [r"ideal gas", r"pv\s*=\s*nrt", r"kinetic theory of gases", r"giant covalent", r"giant ionic", r"lattice structure"],
        "1.4 Chemical energetics & electrochemistry": [r"enthalpy change", r"hess's law", r"entropy", r"gibbs free energy", r"redox", r"standard electrode potential", r"electrochemical cell", r"electrolysis", r"faraday's constant"],
        "1.5 Equilibria & reaction kinetics": [r"le chatelier", r"equilibrium constant", r"\bkc\b", r"\bkp\b", r"buffer solution", r"solubility product", r"rate equation", r"activation energy", r"catalyst", r"order of reaction", r"arrhenius equation"]
    },
    "2. Inorganic Chemistry": {
        "2.1 Periodicity": [r"periodicity", r"trends across period", r"oxide", r"chloride"],
        "2.2 Groups 2 and 17": [r"alkaline earth metal", r"halogen", r"displacement reaction", r"thermal stability", r"solubility of sulfate"],
        "2.3 Transition elements": [r"transition element", r"d-d transition", r"coordination number", r"\bligand\b", r"complex ion", r"stereoisomerism"]
    },
    "3. Organic Chemistry": {
        "3.1 Hydrocarbons": [r"alkane", r"alkene", r"cracking", r"electrophilic addition", r"free radical substitution"],
        "3.2 Halogen & hydroxy derivatives": [r"halogenoalkane", r"hydroxy compound", r"\balcohol\b", r"nucleophilic substitution", r"elimination reaction", r"sn1", r"sn2", r"phenol"],
        "3.3 Carbonyl & carboxylic compounds": [r"carbonyl", r"aldehyde", r"ketone", r"nucleophilic addition", r"carboxylic acid", r"\bester\b", r"acyl chloride", r"esterification", r"hydrolysis of ester"],
        "3.4 Nitrogen compounds & polymers": [r"amine", r"amide", r"amino acid", r"peptide bond", r"diazotisation", r"polymer", r"condensation polymer", r"addition polymer"]
    },
    "4. Analytical Chemistry": {
        "4.1 Spectroscopy & chromatography": [r"infrared spectroscopy", r"mass spectrometry", r"proton nmr", r"carbon-13 nmr", r"chemical shift", r"spin-spin splitting", r"chromatography", r"retention time"]
    }
}

CHEMISTRY_PRIORITY = [
    '4. Analytical Chemistry',
    '3. Organic Chemistry',
    '2. Inorganic Chemistry',
    '1. Physical Chemistry'
]

def parse_filename(filename):
    match = re.match(r"^(\d{4})_(s|w|m)(\d{2})_(qp|ms)_(\d{2})\.pdf$", filename, re.IGNORECASE)
    if not match:
        return None
    code, season_code, short_year, doc_type, paper_variant = match.groups()
    
    year = f"20{short_year}"
    
    if season_code.lower() == 's':
        session = "June"
    elif season_code.lower() == 'w':
        session = "November"
    else:
        session = "March"
        
    paper_number = paper_variant[0]
    
    return {
        "code": code,
        "year": year,
        "session": session,
        "doc_type": doc_type.lower(),
        "paper_number": paper_number,
        "variant": paper_variant
    }

def collect_papers(directory):
    full_papers = {}
    
    if not directory.exists():
        return full_papers
        
    for root, dirs, files in os.walk(directory):
        for file in files:
            info = parse_filename(file)
            if not info:
                continue
                
            year = info["year"]
            session = info["session"]
            
            if year not in full_papers:
                full_papers[year] = {}
            if session not in full_papers[year]:
                full_papers[year][session] = []
                
            if info["doc_type"] == "qp":
                qp_rel = os.path.relpath(Path(root) / file, BASE_DIR).replace(os.sep, '/')
                ms_filename = file.replace("_qp_", "_ms_")
                ms_path = Path(root) / ms_filename
                
                ms_rel = None
                if ms_path.exists():
                    ms_rel = os.path.relpath(ms_path, BASE_DIR).replace(os.sep, '/')
                
                name = f"Paper {info['variant'].upper()}"
                
                full_papers[year][session].append({
                    "name": name,
                    "qp_path": qp_rel,
                    "ms_path": ms_rel
                })
                
    sorted_papers = {}
    for y in sorted(full_papers.keys(), reverse=True):
        sorted_papers[y] = {}
        for s in sorted(full_papers[y].keys()):
            sorted_papers[y][s] = sorted(full_papers[y][s], key=lambda x: x["name"])
            
    return sorted_papers

def classify_text(text, topics_dict, priority_list):
    for cat in priority_list:
        if cat not in topics_dict:
            continue
        subtopics = topics_dict[cat]
        for subtopic, patterns in subtopics.items():
            for pattern in patterns:
                if re.search(pattern, text, re.IGNORECASE):
                    return cat, subtopic
    return None

def extract_questions_from_pdf(reader, paper_number):
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

    question_starts = {}
    
    if paper_number == '1':
        for page_idx, text in enumerate(page_texts):
            matches = re.findall(r'(?:^|\n)\s*([1-9]|[1-3]\d|40)\s+(?=[A-Z\(\[])', text)
            for m in matches:
                qnum = int(m)
                if qnum not in question_starts:
                    question_starts[qnum] = page_idx
    else:
        for page_idx, text in enumerate(page_texts):
            matches = re.findall(r'(?:^|\n)\s*([1-9]|1[0-5])\s+(?:\([a-z]\)|[A-Z]|This question|A |An |The |In |For |Two |Three |Four |Light |Water |Define|Explain|State|Outline|Describe|Calculate|Determine|Draw|Sketch|Suggest|Discuss|Deduce|Show|Estimate|Data)', text)
            for m in matches:
                qnum = int(m)
                if qnum not in question_starts:
                    question_starts[qnum] = page_idx
                    
    sorted_qs = sorted(question_starts.items(), key=lambda x: x[1])
    
    for i, (qnum, start_page) in enumerate(sorted_qs):
        if i + 1 < len(sorted_qs):
            next_start_page = sorted_qs[i + 1][1]
            end_page = next_start_page - 1
        else:
            end_page = min(len(page_texts) - 1, formula_start - 1)
            
        end_page = max(end_page, start_page)
        
        q_text = ""
        for p in range(start_page, end_page + 1):
            q_text += page_texts[p] + "\n"
            
        questions.append({
            "qnum": qnum,
            "start_page": start_page,
            "end_page": end_page,
            "text": q_text
        })
        
    return questions

def extract_topical_questions(subject_dir, subject_name, topics_dict, priority_list):
    output_dir = BASE_DIR / "Content" / f"Sorted_Topics_ALevel_{subject_name}"
    extracted_dir = BASE_DIR / "Content" / f"Extracted_Questions_ALevel_{subject_name}"
    
    if output_dir.exists():
        shutil.rmtree(output_dir)
    if extracted_dir.exists():
        shutil.rmtree(extracted_dir)
        
    output_dir.mkdir(parents=True, exist_ok=True)
    extracted_dir.mkdir(parents=True, exist_ok=True)
    
    syllabus_data = {}
    practice_data = {}
    
    for cat, subcats in topics_dict.items():
        syllabus_data[cat] = {}
        practice_data[cat] = {}
        for sub in subcats.keys():
            syllabus_data[cat][sub] = []
            practice_data[cat][sub] = []
            
    subtopic_groups = {}
    
    print(f"Scanning A-Level {subject_name} papers topically...")
    
    for root, dirs, files in os.walk(subject_dir):
        for file in sorted(files):
            info = parse_filename(file)
            if not info or info["doc_type"] != "qp":
                continue
                
            if info["paper_number"] == '3':
                continue
                
            fpath = Path(root) / file
            print(f"  Segmenting: {file}...")
            
            try:
                reader = PdfReader(fpath)
            except Exception as e:
                print(f"    Error reading PDF: {e}")
                continue
                
            questions = extract_questions_from_pdf(reader, info["paper_number"])
            source_label = f"{info['year']} {info['session']} P{info['variant']}"
            paper_type = f"P{info['paper_number']}"
            
            for q in questions:
                classification = classify_text(q["text"], topics_dict, priority_list)
                if classification:
                    category, subtopic = classification
                    key = (category, subtopic)
                    if key not in subtopic_groups:
                        subtopic_groups[key] = []
                    subtopic_groups[key].append((fpath, q["start_page"], q["end_page"], q["qnum"], source_label, paper_type))
                    
    for (category, subtopic), items in subtopic_groups.items():
        if not items:
            continue
            
        safe_category = category.replace("/", "_")
        safe_subtopic = subtopic.replace("/", "_")
        
        merged_writer = PdfWriter()
        
        for idx, (qp_path, start_page, end_page, qnum, source, paper_type) in enumerate(items):
            try:
                reader = PdfReader(qp_path)
                
                single_writer = PdfWriter()
                for page_idx in range(start_page, end_page + 1):
                    page_obj = reader.pages[page_idx]
                    single_writer.add_page(page_obj)
                    merged_writer.add_page(page_obj)
                    
                practice_out_dir = extracted_dir / safe_category / safe_subtopic
                practice_out_dir.mkdir(parents=True, exist_ok=True)
                
                single_filename = f"{source}_Q{qnum}.pdf"
                single_path = practice_out_dir / single_filename
                
                with open(single_path, "wb") as f:
                    single_writer.write(f)
                single_writer.close()
                
                rel_single_path = os.path.relpath(single_path, BASE_DIR).replace(os.sep, '/')
                rel_full_paper = os.path.relpath(qp_path, BASE_DIR).replace(os.sep, '/')
                
                practice_data[category][subtopic].append({
                    "filename": single_filename,
                    "filepath": rel_single_path,
                    "source": source,
                    "qnum": str(qnum),
                    "paper_type": paper_type,
                    "full_paper_path": rel_full_paper,
                    "pages": f"{start_page+1}-{end_page+1}"
                })
                
            except Exception as e:
                print(f"    Error processing question: {e}")
                
        cat_dir = output_dir / safe_category
        cat_dir.mkdir(parents=True, exist_ok=True)
        
        merged_filename = f"{safe_subtopic}.pdf"
        merged_path = cat_dir / merged_filename
        
        try:
            with open(merged_path, "wb") as f:
                merged_writer.write(f)
            merged_writer.close()
            
            rel_merged_path = os.path.relpath(merged_path, BASE_DIR).replace(os.sep, '/')
            syllabus_data[category][subtopic].append({
                "filename": merged_filename,
                "filepath": rel_merged_path
            })
        except Exception as e:
            print(f"    Error saving merged PDF: {e}")
            
    return syllabus_data, practice_data

def main():
    print("=" * 80)
    print("A-Level Papers Extractor and Topical Classifier")
    print("=" * 80)
    
    alevel_physics_papers = collect_papers(PHYSICS_DIR)
    alevel_chemistry_papers = collect_papers(CHEMISTRY_DIR)
    
    phys_syllabus, phys_practice = extract_topical_questions(PHYSICS_DIR, "Physics", PHYSICS_TOPICS, PHYSICS_PRIORITY)
    chem_syllabus, chem_practice = extract_topical_questions(CHEMISTRY_DIR, "Chemistry", CHEMISTRY_TOPICS, CHEMISTRY_PRIORITY)
    
    data_content = (
        f"const alevelPhysicsFullPapersData = {json.dumps(alevel_physics_papers, indent=2)};\n\n"
        f"const alevelPhysicsSyllabusData = {json.dumps(phys_syllabus, indent=2)};\n\n"
        f"const alevelPhysicsPracticeData = {json.dumps(phys_practice, indent=2)};\n\n"
        f"const alevelChemistryFullPapersData = {json.dumps(alevel_chemistry_papers, indent=2)};\n\n"
        f"const alevelChemistrySyllabusData = {json.dumps(chem_syllabus, indent=2)};\n\n"
        f"const alevelChemistryPracticeData = {json.dumps(chem_practice, indent=2)};\n"
    )
    
    with open(OUTPUT_DATA_FILE, "w", encoding="utf-8") as f:
        f.write(data_content)
        
    print("\n" + "=" * 80)
    print("ALL A-LEVEL EXTRACTION AND CLASSIFICATION COMPLETED SUCCESSFULLY!")
    print("=" * 80)

if __name__ == "__main__":
    main()
