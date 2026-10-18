# AI assistance log

A record of work done with an AI coding agent on this project, to help fill in the AI use
statement in `writeup/replication-report.qmd`. The statement and the rest of the report are
written by the student; this file is a reference, not report text.

**Tool:** Claude Code (Claude Opus 5.5), working in this repository.
**Not used for:** writing, rewriting or paraphrasing any report text; generating, altering or
coding participant data (suspicion coding is done by a human, blind to condition).

## 2026-10-17

### Built the experiment (commit `65628af`)
- Replaced the template demo in `experiment.js` with Experiment 3: four between-subjects
  conditions (high-power prime + feedback sheet, low-power prime + feedback sheet, no prime +
  feedback sheet, no prime + blank sheet), random assignment.
- Power-prime essay screen with the student's exact instructions and a 200-character minimum;
  20 sentence-formation sets in the student's fixed order; the "Pilot Task Participant
  Feedback" sheet with the ten bogus rows (constant `PREVIOUS_FEEDBACK_ROWS`) and row 29.
- Logged condition, essay, each sentence with timestamps, both ratings, suspicion answers,
  demographics.
- Vendored the jsPsych `survey-html-form` plugin.
- Rewrote the robot test (`tests/experiment.spec.js`) to play all four conditions.
- **Checked by:** `npm test` (12 passed); screenshots of every new screen.
- **Student's decisions:** design, materials and wording; contact email; sentences required;
  placeholders for welcome, instructions, suspicion and debrief.

### Restyled the participant pages (commit `4c692ec`)
- Card layout, larger text, colour-blind-safe (Okabe-Ito) palette meeting WCAG AA contrast,
  styled progress bar and buttons, live character counter on the essay, inline error messages.
- **Checked by:** `npm test`; screenshots at 1280×720 and 1920×1080.

### Consent compliance (commit `7c926f7`)
- Checked the code against the consent ("may decline to answer any question"; "anonymity is
  assured"). Found the essay and sentences were required with no opt-out.
- Added an "I'd prefer not to answer" checkbox to the essay and each sentence screen, logged as
  `declined`.
- Changed `scripts/export.js` so essay text never reaches `trials.csv` or `export.json`; it goes
  only to the gitignored `identifiers.csv`.
- **Checked by:** `npm test`; an emulator export searched for a test essay (found only in
  `identifiers.csv`; a declined essay's partial text found nowhere).
- **Student's decisions:** add the opt-out (option A); keep essays out of shared files.

## 2026-10-18

### Cover story and debrief (commit `ae0c993`)
- Added the student's cover-story wording to the welcome screen and before the sentence task,
  and the student's debrief text.
- Made the debrief's second paragraph condition-specific: conditions 1–2 are told why they wrote
  the essay; condition 4 (blank sheet) gets a version that does not claim they saw others'
  ratings. The agent drafted the condition-4 and essay sentences; the student approved them.
- Fixed a progress-bar animation that made the bar lag far behind the real progress.
- **Checked by:** `npm test`, with the robot checking each condition's debrief text.

### Suspicion check and contact email (commit `c10e9d4`)
- Added the student's two suspicion questions after the evaluation sheet, before the debrief.
- Contact email set to the class address.
- **Checked by:** `npm test`; screenshot.
- **Student's decisions:** question wording; keep demographics; keep $10; class email.

### Report analysis code (commit `e29551a`)
- Retargeted the report's code chunks only (text outside chunks verified unchanged): experiment
  ids, original study's numbers, conformity index, Student's t-test (high vs low power) with
  Welch as a robustness check, suspicion exclusion with a blind coding file, power analysis,
  participant funnel, side-by-side figure, exploratory checks, Phase 2 sections.
- **Checked by:** rendering with no data, Phase 1 only, and both phases on robot test data in a
  scratch copy; the original's recomputed effect (−0.87, t(18) = −2.13, p = .047, d = −0.96)
  matches a hand calculation from the reported means, SDs and ns.
- **Student's decisions:** key test, outcome (from the paper), Student's t, suspicion as the
  exclusion, blind coding.
- **Still for the student to check:** the original numbers against the paper.
