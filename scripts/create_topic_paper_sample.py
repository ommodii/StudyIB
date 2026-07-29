from __future__ import annotations

import shutil
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas


def draw_header(pdf: canvas.Canvas, label: str) -> None:
    width, height = A4
    pdf.setFont("Helvetica", 9)
    pdf.drawString(50, height - 35, label)
    pdf.line(50, height - 42, width - 50, height - 42)


def make_2019(path: Path) -> None:
    pdf = canvas.Canvas(str(path), pagesize=A4, invariant=1)
    width, height = A4
    draw_header(pdf, "IB Physics HL Paper 2 - controlled local fixture")
    pdf.setFont("Helvetica-Bold", 12)
    pdf.drawString(50, height - 90, "1. A trolley moves with constant velocity before it accelerates.")
    pdf.setFont("Helvetica", 10)
    pdf.drawString(70, height - 115, "Determine the displacement and kinetic energy, then calculate the work done.")
    pdf.rect(90, height - 260, 260, 100)
    pdf.line(110, height - 235, 315, height - 180)
    pdf.drawString(95, height - 275, "Figure 1: velocity-time graph for the trolley")
    pdf.showPage()

    draw_header(pdf, "Question 1 continued")
    pdf.setFont("Helvetica", 10)
    pdf.drawString(70, height - 90, "Use the velocity-time graph and conservation of energy to justify the result.")
    pdf.drawString(70, height - 120, "Table 1")
    for row in range(4):
        pdf.line(80, height - 145 - row * 25, 300, height - 145 - row * 25)
    for col in range(3):
        pdf.line(80 + col * 110, height - 145, 80 + col * 110, height - 220)
    pdf.showPage()

    draw_header(pdf, "End of Question 1 / start of Question 2")
    pdf.setFont("Helvetica", 9)
    pdf.drawString(50, height - 65, "The final data row above belongs to Question 1.")
    pdf.setFont("Helvetica-Bold", 12)
    pdf.drawString(50, height - 120, "2. A circuit contains a cell and two resistors in parallel.")
    pdf.setFont("Helvetica", 10)
    pdf.drawString(70, height - 145, "Calculate the electric current, resistance and electrical power in the circuit.")
    pdf.circle(160, height - 260, 18)
    pdf.line(178, height - 260, 330, height - 260)
    pdf.line(142, height - 260, 80, height - 260)
    pdf.save()


def make_2021(path: Path) -> None:
    pdf = canvas.Canvas(str(path), pagesize=A4, invariant=1)
    _, height = A4
    draw_header(pdf, "IB Physics HL Paper 2 - second controlled local fixture")
    pdf.setFont("Helvetica-Bold", 12)
    pdf.drawString(50, height - 90, "1. A mass undergoes simple harmonic motion.")
    pdf.setFont("Helvetica", 10)
    pdf.drawString(70, height - 115, "Determine its angular frequency, amplitude and restoring force.")
    pdf.showPage()
    draw_header(pdf, "Question 2")
    pdf.setFont("Helvetica-Bold", 12)
    pdf.drawString(50, height - 90, "2. A radioactive sample undergoes beta decay.")
    pdf.setFont("Helvetica", 10)
    pdf.drawString(70, height - 115, "Calculate the half-life, decay constant and activity of the sample.")
    pdf.save()


def create_sample(destination: Path) -> Path:
    destination.mkdir(parents=True, exist_ok=True)
    first_dir = destination / "2019 May Examination Session"
    second_dir = destination / "2021 November Examination Session"
    first_dir.mkdir(parents=True, exist_ok=True)
    second_dir.mkdir(parents=True, exist_ok=True)
    first = first_dir / "Physics_paper_2_TZ2_HL.pdf"
    duplicate = first_dir / "Physics_paper_2_TZ2_HL_copy.pdf"
    second = second_dir / "Physics_paper_2_TZ1_HL.pdf"
    make_2019(first)
    shutil.copy2(first, duplicate)
    make_2021(second)
    return destination


if __name__ == "__main__":
    repo_root = Path(__file__).resolve().parents[1]
    target = repo_root / "tmp" / "pdfs" / "topic_paper_sample"
    create_sample(target)
    print(target)
