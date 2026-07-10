# AGENTS.md

## Coding guidelines
* Prioritize code correctness and clarity. Speed and efficiency are secondary priorities unless otherwise specified.
* Do not write organizational or comments that summarize the code. Comments should only be written in order to explain "why" the code is written in some way in the case there is a reason that is tricky / non-obvious.
* Prefer implementing functionality in existing files unless it is a new logical component. Avoid creating many small files.
* do not run dev server, user already run it, if user haven't run it just tell him to run it
* if there are function that adds no value besides calling another function, then inline
* Avoid creative additions unless explicitly requested
* Use full words for variable names (no abbreviations like "q" for "queue")

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.
