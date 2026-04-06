import os
import sys
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'ProblemBank.settings')
django.setup()

from BankApp.models import PhysicsClass

classes = list(PhysicsClass.objects.prefetch_related('units__problems').all())
print(f"Total classes in DB: {len(classes)}")

response_data = []
for cls in classes:
    cls_data = {
        "id": cls.id,
        "name": cls.name,
        "sort_order": cls.sort_order,
        "units": []
    }
    
    for unit in cls.units.all():
        unit_data = {
            "id": unit.id,
            "name": unit.name,
            "sort_order": unit.sort_order,
            "problems": []
        }
        
        for problem in unit.problems.all():
            problem_data = {
                "id": problem.id,
                "code": problem.code,
                "title": problem.title,
                "question_count": problem.question_count,
                "yaml_path": problem.yaml_path
            }
            unit_data["problems"].append(problem_data)
        
        cls_data["units"].append(unit_data)
    
    response_data.append(cls_data)

response = {"classes": response_data}
print(f"\nResponse structure:")
print(f"- Keys: {list(response.keys())}")
print(f"- Classes count: {len(response['classes'])}")

if response['classes']:
    first_class = response['classes'][0]
    print(f"\nFirst class:")
    print(f"  - Name: {first_class['name']}")
    print(f"  - Units count: {len(first_class['units'])}")
    
    if first_class['units']:
        first_unit = first_class['units'][0]
        print(f"\n  First unit:")
        print(f"    - Name: {first_unit['name']}")
        print(f"    - Problems count: {len(first_unit['problems'])}")
        
        if first_unit['problems']:
            first_problem = first_unit['problems'][0]
            print(f"\n    First problem:")
            print(f"      - Code: {first_problem['code']}")
            print(f"      - Title: {first_problem['title']}")
            print(f"      - Question count: {first_problem['question_count']}")

# Now verify the full structure would render correctly
print("\n\n=== Checking renderability ===")
print(f"Classes to render: {len(response_data)}")
for i, cls in enumerate(response_data):
    print(f"\nClass {i+1}: {cls['name']}")
    print(f"  - Units: {len(cls['units'])}")
    for j, unit in enumerate(cls['units'][:3]):  # First 3
        print(f"    Unit {j+1}: {unit['name']} ({len(unit['problems'])} problems)")
