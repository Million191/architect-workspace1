"""
score_prompt.py

What this does, in plain English:
You give it a prompt file and a set of test cases (an eval.jsonl file).
For every test case, it fills your data into the prompt, sends the result
to Claude, and checks whether Claude's answer matches the answer you said
was correct. At the end it prints a score and lists exactly which cases
failed and why.

How to run it:
    python scripts/score_prompt.py <path-to-prompt-file> <path-to-eval.jsonl>

Example:
    python scripts/score_prompt.py prompts/tag-audio-source/prompt.md prompts/tag-audio-source/eval.jsonl

Before running it, put your API key in a file named .env in the project's
root folder (same folder as CLAUDE.md), like this:
    ANTHROPIC_API_KEY=your-key-here
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv

# Some work laptops (antivirus, VPN, corporate network security) inspect secure
# connections using their own certificate. Windows already trusts that certificate,
# but Python's own default certificate list doesn't. If the 'truststore' package is
# installed, this tells Python to check against Windows' trusted list instead of its
# own smaller one — it still checks certificates properly, it just checks against the
# right list. If 'truststore' isn't installed, this is silently skipped and Python
# falls back to its normal behavior.
try:
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass

try:
    import anthropic
except ImportError:
    print("The 'anthropic' package isn't installed. Run: pip install anthropic")
    sys.exit(1)

# Which Claude model grades the prompt. Change this line to try a different model.
MODEL_NAME = "claude-sonnet-5"

# How far off a number is allowed to be and still count as a match.
NUMBER_TOLERANCE = 0.01


def load_api_key():
    """Read the .env file that sits next to CLAUDE.md (one folder up from this script)."""
    project_root = Path(__file__).resolve().parent.parent
    load_dotenv(dotenv_path=project_root / ".env")
    return os.environ.get("ANTHROPIC_API_KEY")


def fill_in_prompt(template_text, input_values):
    """Swap every {{field_name}} in the prompt for the matching value from this test case."""
    filled = template_text
    for field_name, value in input_values.items():
        placeholder = "{{" + field_name + "}}"
        replacement = "(not provided)" if value is None else str(value)
        filled = filled.replace(placeholder, replacement)
    return filled


def extract_json_object(raw_text):
    """
    The prompt asks Claude to reply with only a JSON object. Just in case it
    adds a stray word before or after it, pull out the first {...} block.
    Returns a dict, or None if nothing usable was found.
    """
    raw_text = raw_text.strip()
    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{.*\}", raw_text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            return None
    return None


def values_match(expected_value, actual_value):
    """Compare one field the forgiving way the assignment asked for."""
    if actual_value is None:
        return False  # the field is simply missing from Claude's answer

    # Numbers: allow a small tolerance instead of demanding an exact match.
    if isinstance(expected_value, (int, float)) and isinstance(actual_value, (int, float)):
        return abs(expected_value - actual_value) <= NUMBER_TOLERANCE

    # Text: ignore upper/lower case and extra spaces at the ends.
    if isinstance(expected_value, str) and isinstance(actual_value, str):
        return expected_value.strip().lower() == actual_value.strip().lower()

    # Anything else (true/false, lists, etc.) has to match exactly.
    return expected_value == actual_value


def case_passes(expected, actual):
    """Check only the fields listed in `expected`. Extra fields Claude adds are ignored."""
    for field_name, expected_value in expected.items():
        actual_value = actual.get(field_name)
        if not values_match(expected_value, actual_value):
            return False
    return True


def load_cases(eval_file):
    """Read eval.jsonl: one JSON object per line, skipping blank or broken lines."""
    cases = []
    with eval_file.open(encoding="utf-8") as f:
        for line_number, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                cases.append(json.loads(line))
            except json.JSONDecodeError as e:
                print(f"Line {line_number} of {eval_file} isn't valid JSON, skipping it: {e}")
    return cases


def main():
    parser = argparse.ArgumentParser(
        description="Run a prompt against its test cases and score how many pass."
    )
    parser.add_argument("prompt_path", help="Path to the prompt file, e.g. prompts/x/prompt.md")
    parser.add_argument("eval_path", help="Path to the eval file, e.g. prompts/x/eval.jsonl")
    args = parser.parse_args()

    prompt_file = Path(args.prompt_path)
    eval_file = Path(args.eval_path)

    if not prompt_file.exists():
        print(f"Can't find a prompt file at: {prompt_file}")
        print("Write the prompt file first, then run this script again.")
        sys.exit(1)

    if not eval_file.exists():
        print(f"Can't find an eval file at: {eval_file}")
        print("Create the eval.jsonl file first, then run this script again.")
        sys.exit(1)

    api_key = load_api_key()
    if not api_key:
        print("No ANTHROPIC_API_KEY found.")
        print("To fix this: create a file named .env in the project's root folder")
        print("(the same folder as CLAUDE.md and README.md) with one line in it:")
        print("    ANTHROPIC_API_KEY=your-key-here")
        print("You can get a key from https://console.anthropic.com/")
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)
    prompt_template = prompt_file.read_text(encoding="utf-8")

    cases = load_cases(eval_file)
    if not cases:
        print(f"No usable test cases found in {eval_file}.")
        sys.exit(1)

    passed_count = 0
    failures = []  # each entry: {"case": number, "expected": {...}, "actual": {...} or note}

    for i, case in enumerate(cases, start=1):
        expected = case.get("expected", {})
        filled_prompt = fill_in_prompt(prompt_template, case.get("input", {}))

        try:
            response = client.messages.create(
                model=MODEL_NAME,
                max_tokens=512,
                messages=[{"role": "user", "content": filled_prompt}],
            )
        except anthropic.AuthenticationError:
            print("Your ANTHROPIC_API_KEY was found, but the API rejected it as invalid.")
            print("Double check you copied the whole key into your .env file, with no extra spaces or quotes.")
            sys.exit(1)
        except anthropic.APIConnectionError as e:
            if "CERTIFICATE_VERIFY_FAILED" in str(e.__cause__):
                print("Your computer couldn't verify Anthropic's security certificate, so the")
                print("connection was blocked before any data was sent. This is common on work")
                print("laptops where antivirus or VPN software inspects secure connections.")
                print("Try running:  pip install truststore")
                print("(this script will use it automatically next time, no code changes needed)")
            else:
                print("Couldn't reach Anthropic's servers. Check your internet connection and try again.")
            sys.exit(1)
        except anthropic.APIError as e:
            failures.append({"case": i, "expected": expected, "actual": f"(API error: {e})"})
            continue

        response_text = "".join(
            block.text for block in response.content if block.type == "text"
        )
        actual = extract_json_object(response_text)

        if actual is None:
            snippet = response_text[:120].replace("\n", " ")
            failures.append({
                "case": i,
                "expected": expected,
                "actual": f"(couldn't find a JSON object in the reply — it started with: {snippet!r})",
            })
            continue

        if case_passes(expected, actual):
            passed_count += 1
        else:
            failures.append({"case": i, "expected": expected, "actual": actual})

    total = len(cases)
    score = passed_count / total

    print()
    print(f"Score: {score:.2f}  ({passed_count}/{total} cases passed)")
    print(f"Model: {MODEL_NAME}")
    print(f"Cases run: {total}")

    if failures:
        print()
        print("Failed cases:")
        for f in failures:
            print(f"  Case {f['case']}: expected {f['expected']}  |  got {f['actual']}")


if __name__ == "__main__":
    main()
