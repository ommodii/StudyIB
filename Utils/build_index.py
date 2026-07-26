import os
import json
import re
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent.resolve()
INPUT_DIR = BASE_DIR / "Content" / "Sorted_Topics"
HL_DIR = BASE_DIR / "Content" / "Exam_Papers" / "IB_Physics"
OUTPUT_FILE = BASE_DIR / "data.js"

def main():
    # 1. Process Syllabus Topics
    data = {}
    if INPUT_DIR.exists():
        for root, dirs, files in os.walk(INPUT_DIR):
            for file in files:
                if not file.lower().endswith(".pdf"):
                    continue
                    
                file_path = Path(root) / file
                parts = file_path.relative_to(INPUT_DIR).parts
                
                if len(parts) == 3:
                    broad_topic = parts[0]
                    specific_topic = parts[1]
                elif len(parts) == 2:
                    broad_topic = parts[0]
                    specific_topic = "General"
                else:
                    continue
                
                if broad_topic not in data:
                    data[broad_topic] = {}
                    
                if specific_topic not in data[broad_topic]:
                    data[broad_topic][specific_topic] = []
                    
                data[broad_topic][specific_topic].append({
                    "filename": file,
                    "filepath": str(file_path.relative_to(BASE_DIR)).replace("\\", "/") 
                })

    sorted_data = {}
    for cat in sorted(data.keys()):
        sorted_data[cat] = {}
        for subcat in sorted(data[cat].keys()):
            sorted_data[cat][subcat] = sorted(data[cat][subcat], key=lambda x: x["filename"])

    # 2. Process Full Papers
    full_papers = {}
    if HL_DIR.exists():
        for root, dirs, files in os.walk(HL_DIR):
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
                # Remove marks-scheme to get base
                # Some have 'markscheme' and some might have '_markscheme'
                base = re.sub(r'(?i)_?markscheme\.pdf$', '.pdf', pdf.lower())
                
                if base not in paper_groups:
                    paper_groups[base] = {"qp": None, "ms": None, "original_name": ""}
                
                file_path = str((Path(root) / pdf).relative_to(BASE_DIR)).replace("\\", "/")
                
                if "markscheme" in pdf.lower():
                    paper_groups[base]["ms"] = file_path
                else:
                    paper_groups[base]["qp"] = file_path
                    paper_groups[base]["original_name"] = pdf.replace(".pdf", "")
            
            # Add to full_papers
            for base, group in paper_groups.items():
                if group["qp"]: # Only add if we have the question paper
                    name = group["original_name"]
                    display_name = re.sub(r'(?i)^physics_', '', name).replace('_', ' ').replace('  ', ' ').title()
                    full_papers[year][session].append({
                        "name": display_name,
                        "qp_path": group["qp"],
                        "ms_path": group["ms"]
                    })
    
    # Sort full_papers
    sorted_full_papers = {}
    for year in sorted(full_papers.keys(), reverse=True):
        sorted_full_papers[year] = {}
        for session in ["May", "November"]:
            if session in full_papers[year]:
                sorted_full_papers[year][session] = sorted(full_papers[year][session], key=lambda x: x["name"])

    # 3. Write data.js
    js_content = f"const syllabusData = {json.dumps(sorted_data, indent=2)};\n"
    js_content += f"const fullPapersData = {json.dumps(sorted_full_papers, indent=2)};"
    OUTPUT_FILE.write_text(js_content, encoding="utf-8")
    
    total_syllabus = sum(len(sub) for cat in data.values() for sub in cat.values())
    total_full = sum(len(sess) for year in full_papers.values() for sess in year.values())
    print(f"Successfully wrote {OUTPUT_FILE}.")
    print(f" - Syllabus Questions: {total_syllabus}")
    print(f" - Full Papers: {total_full}")

if __name__ == "__main__":
    main()
