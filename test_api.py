import json
import urllib.request

resp = urllib.request.urlopen('http://localhost:8000/api/catalog/')
data = json.load(resp)

print(f'Total classes: {len(data["classes"])}')
for cls in data['classes']:
    print(f'  Class: {cls["name"]}, ID: {cls["id"]}, Units: {len(cls["units"])}')
    for unit in cls["units"][:2]:  # First 2 units
        print(f'    Unit: {unit["name"]}, ID: {unit["id"]}, Problems: {len(unit["problems"])}')
        for prob in unit["problems"][:2]:  # First 2 problems per unit
            print(f'      Problem: {prob.get("code", "N/A")} - {prob.get("title", "N/A")}, Q: {prob["question_count"]}')
