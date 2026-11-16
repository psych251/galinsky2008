/*
 * Replication of Galinsky, Magee, Gruenfeld, Whitson & Liljenquist (2008), Experiment 3:
 * power and conformity to others' evaluations of a boring task.
 *
 * Design
 *   IV:      condition, between subjects (random assignment, see CONDITIONS):
 *            1 high-power prime + feedback sheet, 2 low-power prime + feedback sheet,
 *            3 no prime + feedback sheet,         4 no prime + blank sheet.
 *            Only conditions 1 and 2 are assigned (ASSIGNED_CONDITIONS); 3 and 4 are kept
 *            in the code but no longer used.
 *   DVs:     task "evaluation_sheet": `interesting` and `enjoyable` (1-11, null if blank),
 *            plus `sheet_comment`. Feedback-sheet conditions see 10 previous (high) ratings.
 *   Trials:  consent, welcome, power prime (conditions 1-2 only; `essay`, >= 200 chars),
 *            task instructions, 20 sentence-formation sets in fixed order (task
 *            "sentence_formation": `sentence`, `rt`, `onset_time`, `submit_time`),
 *            evaluation sheet, suspicion (funnel Q1-2), manipulation check (`manip_power`,
 *            5-point, 5 = extremely), funnel Q3-5 (`funnel_noticed` yes/no; `funnel_influence`,
 *            `funnel_belief`, 5-point amount scales, 5 = a great deal),
 *            demographics, debrief. No time limits.
 *   Random:  block randomization to conditions 1 and 2 (each block of 4 Prolific
 *            participants has 2 of each, in random order), from a shared counter in
 *            Firestore; a Prolific ID keeps its condition on reload; visitors without a
 *            Prolific ID are assigned at random. See assignCondition.
 *   Checks:  none built in. Exclusions are defined in the report, not here.
 */

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
window.TEMPLATE_VERSION = "0.1.0";

const EXPERIMENT = {
  // Firestore path: experiments/<id>/participants/... Change it when you start a new study
  // so pilot data and real data never mix (e.g. "smith2016-pilot-a", "smith2016-final").
  id: "galinsky2008-phase2",

  // Trials per Firestore write. 1 = save every trial the moment it finishes (dropouts leave
  // partial data). The free tier allows 20,000 writes/day: with 200 participants x 100 trials
  // you would exceed it, so raise this for long trial-based tasks (e.g. 20).
  chunk_size: 1,

  // Also store the complete jsPsych dataset on the participant document at the end.
  // Costs one extra write and makes export robust; turn off if trials are very large.
  save_full_data_at_end: true,

  // Prolific: if set, participants are redirected to Prolific when they finish.
  // Leave empty for local testing or non-Prolific samples.
  prolific_completion_code: "CPAE4SPN",

  // Contact shown in consent and debrief.
  contact_email: "stanfordpsych251@gmail.com",

  // Does this study need a physical keyboard? There are no key-press trials here, but the
  // power essay and the 20 sentences are a lot of typing, so phones and tablets are turned
  // away before consent. Set to false to allow them.
  requires_keyboard: true,
};

// True on a laptop or desktop: the *primary* pointer is a mouse or trackpad (so laptops with
// touchscreens still pass), and the browser does not say it is a phone. Checking only for any
// fine pointer let an Android phone through in Pilot A: some report a fine pointer (e.g. a
// stylus) even though the touchscreen is primary. See docs/student-guide.md "Devices".
function isComputer() {
  const primaryFine = !!(window.matchMedia && window.matchMedia("(pointer: fine)").matches);
  const ua = navigator.userAgent || "";
  const mobile = (navigator.userAgentData && navigator.userAgentData.mobile === true) ||
    /Mobi|iPhone|iPod|Android/i.test(ua);
  return primaryFine && !mobile;
}

// `?emulator=1` in the URL sends data to the local emulator instead of the real project.
// Used by `npm test`; handy for development too (start it with `npm run emulators`).
const URL_PARAMS = new URLSearchParams(window.location.search);
const USE_EMULATOR = URL_PARAMS.get("emulator") === "1";
// `?chunk_size=N` overrides the setting above; used by the test suite to exercise chunked writes.
const CHUNK_SIZE = Number(URL_PARAMS.get("chunk_size")) || EXPERIMENT.chunk_size;
// Test-only: `?cc=CODE` sets a Prolific completion code during emulator runs, so the test
// suite can check the screen a participant sees once you have set yours. Ignored in live runs.
if (USE_EMULATOR && URL_PARAMS.get("cc")) EXPERIMENT.prolific_completion_code = URL_PARAMS.get("cc");
// Conditions participants are randomly assigned to, with equal probability. Conditions 3 and 4
// (no prime) are still defined in CONDITIONS below but are not assigned.
const ASSIGNED_CONDITIONS = [1, 2];
// Test-only: `?condition=N` forces one of the assigned conditions during emulator runs. Ignored
// in live runs, and for a condition that is not assigned.
const FORCED_CONDITION = USE_EMULATOR ? ASSIGNED_CONDITIONS.find((c) => String(c) === URL_PARAMS.get("condition")) : undefined;
// Condition assignment: block randomization (see assignCondition below). A shared counter in
// Firestore hands each new participant the next slot; every block of 4 slots holds each
// assigned condition twice, in a shuffled order, so the conditions stay balanced as data come
// in (in Phase 1, simple random assignment drifted to 61 vs 34) while who gets what is still
// random. The first assignment for a Prolific ID is stored (under a hash of the ID), so a
// reload or restart keeps the same condition (in Phase 1, 4 analysed participants saw both
// primes). Visitors without a real Prolific ID (local tests, pilots, Prolific's unfilled
// "{{%PROLIFIC_PID%}}" placeholder) are assigned at random and do not use up slots.
const BLOCK = ASSIGNED_CONDITIONS.flatMap((c) => [c, c]); // [1, 1, 2, 2]

// 32-bit FNV-1a hash of a string.
function fnv1a(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

// The condition for slot `slot`: block floor(slot / 4) is BLOCK shuffled by a generator seeded
// from the experiment id and block number, so every browser agrees on the order.
function blockCondition(slot) {
  let seed = fnv1a(`${EXPERIMENT.id}:block:${Math.floor(slot / BLOCK.length)}`);
  const rand = () => { // mulberry32
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const order = BLOCK.slice();
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order[slot % BLOCK.length];
}

// Fallback when the counter cannot be reached: the same condition for the same Prolific ID,
// split between conditions like a coin flip.
function conditionFromProlificId(pid) {
  return ASSIGNED_CONDITIONS[fnv1a(pid) % ASSIGNED_CONDITIONS.length];
}

async function sha256Hex(str) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Returns { condition, method, slot }. `method` records how the condition was chosen:
// "block" (new slot from the counter), "reused" (this Prolific ID's earlier assignment),
// "random" (no Prolific ID), "forced" (test-only ?condition=), or "pid-hash" (the counter
// could not be reached, e.g. offline). `slot` is the counter slot, or null.
async function assignCondition(saver) {
  if (FORCED_CONDITION) return { condition: FORCED_CONDITION, method: "forced", slot: null };
  const pid = URL_PARAMS.get("PROLIFIC_PID");
  if (!pid || pid.includes("{{")) {
    return { condition: ASSIGNED_CONDITIONS[Math.floor(Math.random() * ASSIGNED_CONDITIONS.length)], method: "random", slot: null };
  }
  if (saver.mode === "firebase" || saver.mode === "emulator") {
    try {
      const { fb, db } = saver;
      const counterRef = fb.doc(db, "experiments", EXPERIMENT.id, "assignment", "counter");
      const byIdRef = fb.doc(db, "experiments", EXPERIMENT.id, "assignment_by_id", await sha256Hex(`${EXPERIMENT.id}:${pid}`));
      // A transaction, so two participants starting at the same moment cannot get the same slot.
      return await fb.runTransaction(db, async (tx) => {
        const prior = await tx.get(byIdRef);
        if (prior.exists()) return { condition: prior.data().condition, method: "reused", slot: prior.data().slot };
        const counter = await tx.get(counterRef);
        const slot = counter.exists() ? counter.data().next : 0;
        const condition = blockCondition(slot);
        if (counter.exists()) tx.update(counterRef, { next: slot + 1 });
        else tx.set(counterRef, { next: 1 });
        tx.set(byIdRef, { condition, slot });
        return { condition, method: "block", slot };
      });
    } catch (e) {
      console.warn("[assignment] block randomization unavailable; assigning from the Prolific ID instead:", e);
    }
  }
  return { condition: conditionFromProlificId(pid), method: "pid-hash", slot: null };
}

// ---------------------------------------------------------------------------
// Boot: connect the saver first so even a crash in the first trial gets logged.
// ---------------------------------------------------------------------------
(async function main() {
  const deviceSupported = !EXPERIMENT.requires_keyboard || isComputer();

  const saver = await DataSaver.init({
    experiment_id: EXPERIMENT.id,
    chunk_size: CHUNK_SIZE,
    save_full_data_at_end: EXPERIMENT.save_full_data_at_end,
    use_emulator: USE_EMULATOR,
    contact_email: EXPERIMENT.contact_email,
  });
  window.__saver = saver; // for debugging and the automated test

  // Record the device verdict on the participant document before anything else, so a
  // participant turned away below is still visible in the data rather than simply absent.
  saver.updateParticipant({ device_supported: deviceSupported, requires_keyboard: EXPERIMENT.requires_keyboard });

  if (!deviceSupported) {
    document.body.innerHTML =
      '<div id="device-unsupported" class="jspsych-content" style="max-width:640px;margin:15vh auto;font:16px/1.6 system-ui,sans-serif;">' +
      "<h2>Please use a computer</h2>" +
      "<p>This study needs a computer with a physical keyboard, because part of it is answered " +
      "by pressing keys. Phones and tablets cannot be used.</p>" +
      "<p>Please reopen this link on a laptop or desktop computer. If you were sent here from " +
      "Prolific, you can return the study and take it later on a computer; nothing has been recorded " +
      "against you.</p>" +
      "<p>Questions: <a href=\"mailto:" + EXPERIMENT.contact_email + "\">" + EXPERIMENT.contact_email + "</a></p></div>";
    return;
  }

  const jsPsych = initJsPsych({
    show_progress_bar: true,
    auto_update_progress_bar: true,
    on_data_update: (trial) => saver.onTrial(trial),
    on_finish: async () => {
      const el = jsPsych.getDisplayElement();
      el.innerHTML = '<div id="finish-message"><p class="thanks">Saving your responses…</p></div>';
      // finish() flushes remaining trials, marks the participant complete, and (only if
      // saving failed) appends a download-fallback box to the display element.
      const result = await saver.finish(jsPsych);
      const consentRow = jsPsych.data.get().filter({ task: "consent" }).values()[0];
      const consented = !consentRow || consentRow.consented !== false;
      const msg = document.getElementById("finish-message");

      if (!consented) {
        msg.innerHTML = "<h2 class='thanks'>Thank you</h2><p class='thanks'>You chose not to participate. " +
          "You may close this window" + (EXPERIMENT.prolific_completion_code ? " and return the study on Prolific" : "") + ".</p>";
        return;
      }
      if (result.ok && EXPERIMENT.prolific_completion_code && !USE_EMULATOR) {
        msg.innerHTML = "<p class='thanks'>Saved. Returning you to Prolific…</p>";
        window.location.href =
          "https://app.prolific.com/submissions/complete?cc=" + EXPERIMENT.prolific_completion_code;
        return;
      }
      // In emulator/test runs we stay on the page instead of navigating to Prolific, so that
      // setting a completion code can never turn `npm test` or CI red. Live runs redirect above.
      msg.innerHTML =
        "<h2 class='thanks'>All done</h2>" +
        (result.ok ? "<p class='thanks'>Your responses were saved. Thank you for participating!</p>" : "") +
        (EXPERIMENT.prolific_completion_code
          ? "<p class='thanks'>Your completion code is <strong>" + EXPERIMENT.prolific_completion_code + "</strong>.</p>"
          : "");
    },
  });

  // Record the participant id and URL parameters on every trial row.
  jsPsych.data.addProperties({
    // Must be the run-scoped document id, so trial rows join to participants.csv on export.
    participant_id: saver.docId,
    prolific_pid: saver.params.PROLIFIC_PID || null,
    experiment_id: EXPERIMENT.id,
  });

  // Assignment to one of the ASSIGNED_CONDITIONS by block randomization (assignCondition,
  // above), recorded on every trial and on the participant document with how it was chosen
  // (`assignment_method`) and its counter slot (`assignment_slot`). `condition` is the number
  // 1-4; `prime` and `sheet` spell out its two components so the analysis never has to
  // decode the number.
  const CONDITIONS = {
    1: { prime: "high_power", sheet: "feedback" },
    2: { prime: "low_power", sheet: "feedback" },
    3: { prime: "none", sheet: "feedback" },
    4: { prime: "none", sheet: "blank" },
  };
  const assignment = await assignCondition(saver);
  const condition = assignment.condition;
  const { prime, sheet } = CONDITIONS[condition];
  const assignmentFields = { assignment_method: assignment.method, assignment_slot: assignment.slot };
  jsPsych.data.addProperties({ condition: condition, prime: prime, sheet: sheet, ...assignmentFields });
  saver.updateParticipant({ condition: condition, prime: prime, sheet: sheet, ...assignmentFields });
  window.__assignment = assignment; // for the automated test
  window.__condition = condition; // for the automated test

  // -------------------------------------------------------------------------
  // 1. Consent (course-wide IRB text; edit only the contact address)
  // -------------------------------------------------------------------------
  const consent = {
    type: jsPsychHtmlButtonResponse,
    stimulus: `
      <div class="consent">
        <h2>Consent</h2>
        <p>By answering the following questions, you are participating in a study being performed by
        cognitive scientists in the Stanford Department of Psychology. If you have questions about
        this research, please contact us at <a href="mailto:${EXPERIMENT.contact_email}">${EXPERIMENT.contact_email}</a>.
        You must be at least 18 years old to participate. Your participation in this research is
        voluntary. You may decline to answer any or all of the following questions. You may decline
        further participation, at any time, without adverse consequences. Your anonymity is assured;
        the researchers who have requested your participation will not receive any personal
        information about you.</p>
      </div>`,
    choices: ["I agree to participate", "I do not agree"],
    data: { task: "consent" },
    on_finish: (data) => {
      data.consented = data.response === 0;
      if (!data.consented) {
        // No end message here: jsPsych would paint it over the screen that on_finish renders.
        jsPsych.abortExperiment();
      }
    },
  };

  // -------------------------------------------------------------------------
  // 2. Welcome
  // -------------------------------------------------------------------------
  const welcome = {
    type: jsPsychInstructions,
    pages: [
      // Cover story (original: participants were told they would complete several tasks, some
      // asking about perceptions and some about recalling past experiences).
      `<h2>Welcome</h2>
       <p>Welcome! In this study you will complete several tasks. Some will ask about your
       perceptions, and some will ask you to recall past experiences.</p>`,
    ],
    show_clickable_nav: true,
    data: { task: "welcome" },
  };

  // -------------------------------------------------------------------------
  // 3. Power prime (conditions 1 and 2 only): recall essay, at least 200 characters
  // -------------------------------------------------------------------------
  const PRIME_INSTRUCTIONS = {
    high_power:
      "Recall a particular incident in which you had power over another individual or individuals. " +
      "By power, we mean a situation in which you controlled the ability of another person or persons " +
      "to get something they wanted, or were in a position to evaluate those individuals. Please " +
      "describe this situation in which you had power—what happened, how you felt, etc.",
    low_power:
      "Please recall a particular incident in which someone else had power over you. By power, we mean " +
      "a situation in which someone had control over your ability to get something you wanted, or was " +
      "in a position to evaluate you. Please describe this situation in which you did not have " +
      "power—what happened, how you felt, etc.",
  };
  const PRIME_MIN_CHARS = 200;
  // The consent says participants may decline any question, so the essay and each sentence
  // have this opt-out; ticking it lifts the requirement and is logged as `declined: true`.
  const DECLINE_TEXT = "I'd prefer not to answer";
  const essayCounterText = (n) =>
    n >= PRIME_MIN_CHARS
      ? `✓ ${n} characters (minimum of ${PRIME_MIN_CHARS} reached)`
      : `${n} / ${PRIME_MIN_CHARS} characters minimum`;
  const powerPrime = {
    timeline: [{
      type: jsPsychSurvey,
      survey_json: () => ({
        showQuestionNumbers: "off",
        completeText: "Continue",
        textUpdateMode: "onTyping", // so the character counter updates on every keystroke
        pages: [{
          elements: [{
            type: "comment", name: "essay", rows: 14, autoGrow: true,
            title: PRIME_INSTRUCTIONS[prime],
            description: essayCounterText(0), descriptionLocation: "underInput",
            isRequired: true,
            requiredErrorText: `Please write at least ${PRIME_MIN_CHARS} characters.`,
            validators: [{ type: "text", minLength: PRIME_MIN_CHARS,
              text: `Please write at least ${PRIME_MIN_CHARS} characters.` }],
            // Hidden (so neither required nor validated) once the participant declines; SurveyJS
            // then drops any text typed in it when the page is submitted.
            visibleIf: "{essay_declined} != true",
          }, {
            type: "boolean", name: "essay_declined", renderAs: "checkbox",
            title: DECLINE_TEXT, label: DECLINE_TEXT, titleLocation: "hidden",
          }],
        }],
      }),
      // Live character counter, shown under the text box.
      survey_function: (survey) => {
        const essay = survey.getQuestionByName("essay");
        survey.onValueChanged.add(() => {
          essay.description = essayCounterText((essay.value || "").length);
        });
      },
      data: { task: "power_prime" },
      on_finish: (data) => {
        data.declined = data.response.essay_declined === true;
        data.essay = data.declined ? "" : data.response.essay || "";
        data.essay_chars = data.essay.length;
      },
    }],
    conditional_function: () => prime !== "none",
  };

  // -------------------------------------------------------------------------
  // 4. Sentence formation: 20 sets of five words in fixed order; type a sentence using four
  // -------------------------------------------------------------------------
  const sentenceInstructions = {
    type: jsPsychInstructions,
    pages: [
      // Cover story for the evaluation sheet (original: the task was said to be pilot tested
      // by other researchers, who wanted feedback), then the task instructions.
      `<h2>Sentence task</h2>
       <p>The next task is pilot tested for possible inclusion in a future experiment on
       psycholinguistic decision-making processes. Because it is only a pilot, researchers would
       like your feedback, and afterwards you will be asked a few questions about what you thought
       of the task.</p>
       <p>On each screen you will see five words. Please type a sentence that uses <strong>four</strong> of them.</p>`,
    ],
    show_clickable_nav: true,
    data: { task: "instructions" },
  };
  const SENTENCE_SETS = [
    "dog the barked loudly yellow",
    "she bread bought fresh Monday",
    "rain falls the heavily soft",
    "he coffee drinks hot green",
    "children the played outside tall",
    "window open the was wide",
    "we dinner early ate lamp",
    "birds sing every morning the",
    "train the arrived late stone",
    "I a letter wrote paper",
    "garden the green grows slowly",
    "river flows the south toward",
    "he shoes new bought red",
    "lamp the bright is table",
    "they walked home the carefully",
    "soup is the hot cold",
    "she tall is very quietly",
    "baker the bread bakes fresh",
    "snow covered the hills wide",
    "clock the ticks loudly wall",
  ].map((words, i) => ({ set_number: i + 1, words: words }));
  let sentenceOnset = null;
  const sentenceTrial = {
    type: jsPsychSurveyHtmlForm,
    html: () => `
      <div class="sentence-set" data-set="${jsPsych.evaluateTimelineVariable("set_number")}">
        <p class="sentence-count">Set ${jsPsych.evaluateTimelineVariable("set_number")} of ${SENTENCE_SETS.length}</p>
        <p class="sentence-words">${jsPsych.evaluateTimelineVariable("words")}</p>
        <p><input type="text" id="sentence" name="sentence" required pattern=".*\\S.*"
          title="Please type a sentence." autocomplete="off" spellcheck="false"
          aria-describedby="sentence-error"></p>
        <p class="field-error" id="sentence-error" role="alert" hidden>Please type a sentence.</p>
        <p class="decline"><label><input type="checkbox" id="sentence-declined" name="declined" value="yes">
          ${DECLINE_TEXT}</label></p>
      </div>`,
    autofocus: "sentence",
    data: {
      task: "sentence_formation",
      set_number: jsPsych.timelineVariable("set_number"),
      words: jsPsych.timelineVariable("words"),
    },
    // Wall-clock time the words appeared and the sentence was submitted (rt is the difference).
    on_load: () => {
      sentenceOnset = new Date().toISOString();
      // Show an inline message instead of the browser's tooltip when the box is empty.
      const input = document.getElementById("sentence");
      const error = document.getElementById("sentence-error");
      input.addEventListener("invalid", (e) => {
        e.preventDefault();
        error.hidden = false;
        input.setAttribute("aria-invalid", "true");
        input.focus();
      });
      input.addEventListener("input", () => {
        if (input.validity.valid) {
          error.hidden = true;
          input.removeAttribute("aria-invalid");
        }
      });
      // Declining disables the box, which lifts the requirement.
      const decline = document.getElementById("sentence-declined");
      decline.addEventListener("change", () => {
        input.disabled = decline.checked;
        error.hidden = true;
        input.removeAttribute("aria-invalid");
        if (!decline.checked) input.focus();
      });
    },
    on_finish: (data) => {
      data.declined = data.response.declined === "yes";
      data.sentence = data.declined ? null : data.response.sentence;
      data.onset_time = sentenceOnset;
      data.submit_time = new Date().toISOString();
    },
  };
  const sentenceTask = { timeline: [sentenceTrial], timeline_variables: SENTENCE_SETS };

  // -------------------------------------------------------------------------
  // 5. Evaluation sheet: "Pilot Task Participant Feedback"
  // -------------------------------------------------------------------------
  // The ten earlier "participants" shown above the participant's own row (row 29) in the
  // feedback-sheet conditions (1-3). Condition 4 sees the same sheet with only row 29.
  const PREVIOUS_FEEDBACK_ROWS = [
    { participant: 19, interesting: 9, enjoyable: 10, comment: "" },
    { participant: 20, interesting: 10, enjoyable: 9, comment: "cool task" },
    { participant: 21, interesting: 11, enjoyable: 11, comment: "Fun, like a puzzle" },
    { participant: 22, interesting: 9, enjoyable: 8, comment: "" },
    { participant: 23, interesting: 10, enjoyable: 8, comment: "" },
    { participant: 24, interesting: 9, enjoyable: 9, comment: "" },
    { participant: 25, interesting: 11, enjoyable: 11, comment: "☺" }, // a smiley face
    { participant: 26, interesting: 10, enjoyable: 9, comment: "" },
    { participant: 27, interesting: 10, enjoyable: 11, comment: "Much better than the typical experiment" },
    { participant: 28, interesting: 10, enjoyable: 10, comment: "" },
  ];
  const OWN_ROW_NUMBER = 29;
  const shownRows = sheet === "feedback" ? PREVIOUS_FEEDBACK_ROWS : [];
  const evaluationSheet = {
    type: jsPsychSurveyHtmlForm,
    html: `
      <div class="feedback-sheet" data-rows-shown="${shownRows.length}">
        <h2>Pilot Task Participant Feedback</h2>
        <p>In the first two columns, please answer the questions ‘How interesting was this
        experiment?’ and ‘Overall, how much did you enjoy this experiment?’ Mark from 1 to 11
        (1 = not at all, 11 = extremely).</p>
        <table>
          <thead><tr><th>Participant</th><th>Interesting</th><th>Enjoyable</th><th>Comments</th></tr></thead>
          <tbody>
            ${shownRows.map((r) => `<tr class="previous-row"><td>${r.participant}</td><td>${r.interesting}</td><td>${r.enjoyable}</td><td>${r.comment}</td></tr>`).join("")}
            <tr class="own-row">
              <td>${OWN_ROW_NUMBER}</td>
              ${["interesting", "enjoyable"].map((name) => `<td>
                <input type="number" name="${name}" min="1" max="11" step="1" required
                  aria-label="${name === "interesting" ? "Interesting" : "Enjoyable"} (1 to 11)" aria-describedby="rating-error">
                <label class="rating-decline"><input type="checkbox" name="${name}_declined" value="yes"> ${DECLINE_TEXT}</label>
              </td>`).join("")}
              <td><input type="text" name="comments" aria-label="Comments" autocomplete="off"></td>
            </tr>
          </tbody>
        </table>
        <p class="field-error" id="rating-error" role="alert" hidden>Please give both ratings (1 to 11), or tick "${DECLINE_TEXT}".</p>
      </div>`,
    data: { task: "evaluation_sheet", rows_shown: shownRows.length, own_row: OWN_ROW_NUMBER },
    // The two ratings are required so they cannot be skipped by accident; the consent lets
    // participants decline any question, so each has an opt-out that lifts the requirement
    // and is logged as `interesting_declined` / `enjoyable_declined`. A declined rating is
    // saved as null, so the conformity index is missing, as for a blank rating in Phase 1.
    on_load: () => {
      const error = document.getElementById("rating-error");
      for (const name of ["interesting", "enjoyable"]) {
        const input = document.querySelector(`.feedback-sheet input[name="${name}"]`);
        const decline = document.querySelector(`.feedback-sheet input[name="${name}_declined"]`);
        input.addEventListener("invalid", (e) => {
          e.preventDefault();
          error.hidden = false;
          input.setAttribute("aria-invalid", "true");
        });
        input.addEventListener("input", () => {
          if (input.validity.valid) input.removeAttribute("aria-invalid");
        });
        // Declining disables the box, which lifts the requirement.
        decline.addEventListener("change", () => {
          input.disabled = decline.checked;
          input.removeAttribute("aria-invalid");
          error.hidden = true;
        });
      }
    },
    on_finish: (data) => {
      const toRating = (v) => (v === "" || v === undefined ? null : Number(v));
      data.interesting_declined = data.response.interesting_declined === "yes";
      data.enjoyable_declined = data.response.enjoyable_declined === "yes";
      data.interesting = data.interesting_declined ? null : toRating(data.response.interesting);
      data.enjoyable = data.enjoyable_declined ? null : toRating(data.response.enjoyable);
      data.sheet_comment = data.response.comments || "";
    },
  };

  // -------------------------------------------------------------------------
  // 6. Suspicion
  // -------------------------------------------------------------------------
  const suspicion = {
    type: jsPsychSurvey,
    survey_json: {
      showQuestionNumbers: "off",
      completeText: "Continue",
      pages: [{
        elements: [
          // Written stand-in for the original's debriefing interview, where suspicious
          // participants were identified. Asked after the ratings, before anything is revealed.
          { type: "comment", name: "suspicion_purpose", title: "What do you think this study was about?", rows: 4 },
          { type: "comment", name: "suspicion_strange", title: "Did anything about the study seem strange or unusual? If so, what?", rows: 4 },
        ],
      }],
    },
    data: { task: "suspicion" },
  };

  // -------------------------------------------------------------------------
  // 6b. Phase 2: manipulation check, then the rest of the funnel debrief
  // -------------------------------------------------------------------------
  // Both come after the ratings and after funnel questions 1-2 (the suspicion page above,
  // unchanged from Phase 1, which the blind suspicion coding uses), so neither can affect the
  // key measure or the exclusion rule. Identical in both conditions; nothing here is required,
  // since the consent lets participants decline any question.
  // All three rating questions follow the course's survey-design guidance (Week 6b): a unipolar
  // question gets 5 points with the recommended verbal labels, words only, in a vertical list
  // with the top of the scale first. "How [adjective]?" questions use the modifier labels and
  // "How much?" questions the amount labels. Saved as 5 (top of the scale) to 1 (bottom).
  const MODIFIER_LABELS = ["Extremely", "Very", "Moderately", "Slightly", "Not at all"];
  const AMOUNT_LABELS = ["A great deal", "A lot", "A moderate amount", "A little", "None at all"];
  const scale5 = (name, title, labels) => ({
    type: "radiogroup", name, title,
    choices: labels.map((label, i) => ({ value: labels.length - i, text: label })),
  });
  const manipulationCheck = {
    type: jsPsychSurvey,
    survey_json: {
      showQuestionNumbers: "off",
      completeText: "Continue",
      pages: [{
        elements: [
          scale5("manip_power", "While you were writing about the situation you recalled at the start of the study, how powerful did you feel?", MODIFIER_LABELS),
        ],
      }],
    },
    data: { task: "manipulation_check" },
    on_finish: (data) => {
      data.manip_power = data.response.manip_power ?? null;
    },
  };
  const funnel = {
    type: jsPsychSurvey,
    survey_json: {
      showQuestionNumbers: "off",
      completeText: "Continue",
      pages: [{
        elements: [
          { type: "radiogroup", name: "funnel_noticed", title: "Did you notice the other participants' ratings?", choices: ["Yes", "No"] },
          scale5("funnel_influence", "How much did the ratings influence yours?", AMOUNT_LABELS),
          scale5("funnel_belief", "How much did you believe those ratings came from real previous participants?", AMOUNT_LABELS),
        ],
      }],
    },
    data: { task: "funnel" },
    on_finish: (data) => {
      data.funnel_noticed = data.response.funnel_noticed ?? null;
      data.funnel_influence = data.response.funnel_influence ?? null;
      data.funnel_belief = data.response.funnel_belief ?? null;
    },
  };

  // -------------------------------------------------------------------------
  // 7. Demographics
  // -------------------------------------------------------------------------
  const demographics = {
    type: jsPsychSurvey,
    survey_json: {
      showQuestionNumbers: "off",
      completeText: "Continue",
      pages: [
        {
          elements: [
            // The consent text promises participants may decline any question, so nothing here is required.
            { type: "text", name: "age", title: "How old are you?", inputType: "number", min: 18, max: 120 },
            {
              type: "radiogroup", name: "gender", title: "What is your gender?",
              choices: ["Woman", "Man", "Non-binary"], showOtherItem: true, showNoneItem: true, noneText: "Prefer not to say",
            },
            { type: "boolean", name: "native_english", title: "Is English your first language?", labelTrue: "Yes", labelFalse: "No" },
          ],
        },
      ],
    },
    data: { task: "demographics" },
  };

  // -------------------------------------------------------------------------
  // 8. Debrief
  // -------------------------------------------------------------------------
  // The second paragraph depends on the condition: conditions 1-2 are told why they wrote the
  // power essay, and condition 4 (blank sheet) is told what the other sheets showed.
  const DEBRIEF_PRIME = {
    high_power: "At the start of the study, you were asked to describe a time when you had power " +
      "over someone else. This was to bring the experience of having power to mind before the " +
      "sentence task. ",
    low_power: "At the start of the study, you were asked to describe a time when someone else had " +
      "power over you. This was to bring the experience of lacking power to mind before the " +
      "sentence task. ",
    none: "",
  };
  const DEBRIEF_SHEET = {
    feedback: "Today you completed a task that asked you to create short sentences out of a small " +
      "selection of words. You then saw a sheet that showed you what fellow participants thought of " +
      "the task. However you were given some incomplete information - we are not collecting pilot " +
      "data for a psycholinguistic decision-making task. The opinions you saw were created for this " +
      "study and did not come from fellow participants. This allowed us to examine how you responded " +
      "to differing opinions under controlled conditions.",
    blank: "Today you completed a task that asked you to create short sentences out of a small " +
      "selection of words, and then rated the task on a feedback sheet. However you were given some " +
      "incomplete information - we are not collecting pilot data for a psycholinguistic " +
      "decision-making task. Some participants saw ratings on their sheet that appeared to come from " +
      "fellow participants; those ratings were created for this study. Your sheet was left blank so " +
      "that we could compare how people rate the task with and without seeing others’ opinions.",
  };
  const debrief = {
    type: jsPsychHtmlButtonResponse,
    stimulus: `
      <div class="debrief">
        <h2>Thank you for your contribution to science!</h2>
        <p>Previous research suggests that power has an effect on our relationships with other
        people, including abstract concepts like conformity and creativity. We are interested in how
        having power affects the way you respond to others’ diverging thoughts and opinions.</p>
        <p>${DEBRIEF_PRIME[prime]}${DEBRIEF_SHEET[sheet]} We did not reveal the study’s true purpose
        beforehand because knowing what we were investigating could have influenced your responses.</p>
        <p>You will be paid at a rate of $8 per hour for your participation in this study, and you
        will receive your payment within a week of completing the study. If you have any further
        questions about this study, please contact
        <a href="mailto:${EXPERIMENT.contact_email}">${EXPERIMENT.contact_email}</a>.</p>
        <p>Thanks again for your participation!</p>
        <p class="debrief-finish">Press the button to save your responses and finish.</p>
      </div>`,
    choices: ["Finish"],
    data: { task: "debrief" },
  };

  await jsPsych.run([
    consent,
    welcome,
    powerPrime,
    sentenceInstructions,
    sentenceTask,
    evaluationSheet,
    suspicion,
    manipulationCheck,
    funnel,
    demographics,
    debrief,
  ]);
})();
