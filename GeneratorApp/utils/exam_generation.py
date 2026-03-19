import re
from pathlib import Path
from importlib import import_module

import yaml

def extract_problem(path, index):
    with open(path, "r", encoding="utf-8") as file:
        data = yaml.safe_load(file)

    question = data["questions"][index]
    question_type = ""
    figure = None

    if "numerical" in question:
        problem = question["numerical"]["text"]
        question_type = "numerical"
        if "figure" in question["numerical"]:
            figure = question["numerical"]["figure"]

    if "multiple_choice" in question:
        problem = question["multiple_choice"]["text"]
        question_type = "multiple_choice"
        if "figure" in question["multiple_choice"]:
            figure = question["multiple_choice"]["figure"]

    return problem, question_type, figure


def string_to_latex(string):
    if string is None:
        return ""
    string = str(string)
    string = string.replace("<latex>", "$").replace("</latex>", "$")
    string = string.replace("<ul>", "").replace("</ul>", "")
    string = string.replace("<li>", "• ").replace("</li>", "\n")
    string = string.replace("<p>", "").replace("</p>", "")
    string = string.replace("<b>", "$\\textbf{").replace("</b>", "}$")
    string = string.replace("<strong>", "$\\textbf{").replace("</strong>", "}$")
    string = re.sub(r"\*\*(.*?)\*\*", r"$\\textbf{\1}$", string)
    string = re.sub(r"\*(.*?)\*", r"$\\textbf{\1}$", string)
    return string
