/*
 * Replication of Galinsky, Magee, Gruenfeld, Whitson & Liljenquist (2008), Experiment 3:
 * power and conformity to others' evaluations of a boring task.
 *
 * Design
 *   IV:      condition, between subjects, 4 levels (random assignment, see CONDITIONS):
 *            1 high-power prime + feedback sheet, 2 low-power prime + feedback sheet,
 *            3 no prime + feedback sheet,         4 no prime + blank sheet.
 *   DVs:     task "evaluation_sheet": `interesting` and `enjoyable` (1-11, null if blank),
 *            plus `sheet_comment`. Feedback-sheet conditions see 10 previous (high) ratings.
 *   Trials:  consent, welcome, power prime (conditions 1-2 only; `essay`, >= 200 chars),
 *            task instructions, 20 sentence-formation sets in fixed order (task
 *            "sentence_formation": `sentence`, `rt`, `onset_time`, `submit_time`),
 *            evaluation sheet, suspicion, demographics, debrief. No time limits.
 *   Random:  simple random assignment to the 4 conditions; no counterbalancing.
 *   Checks:  none built in. Exclusions are defined in the report, not here.
 */

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
window.TEMPLATE_VERSION = "0.1.0";

const EXPERIMENT = {
  // Firestore path: experiments/<id>/participants/... Change it when you start a new study
  // so pilot data and real data never mix (e.g. "smith2016-pilot-a", "smith2016-final").
  id: "galinsky2008-pilot-a",

  // Trials per Firestore write. 1 = save every trial the moment it finishes (dropouts leave
  // partial data). The free tier allows 20,000 writes/day: with 200 participants x 100 trials
  // you would exceed it, so raise this for long trial-based tasks (e.g. 20).
  chunk_size: 1,

  // Also store the complete jsPsych dataset on the participant document at the end.
  // Costs one extra write and makes export robust; turn off if trials are very large.
  save_full_data_at_end: true,

  // Prolific: if set, participants are redirected to Prolific when they finish.
  // Leave empty for local testing or non-Prolific samples.
  prolific_completion_code: "",

  // Contact shown in consent and debrief.
  contact_email: "stanfordpsych251@gmail.com",

  // Does this study need a physical keyboard? There are no key-press trials here, but the
  // power essay and the 20 sentences are a lot of typing, so phones and tablets are turned
  // away before consent. Set to false to allow them.
  requires_keyboard: true,
};

// True on anything with a mouse, trackpad, or stylus, including laptops with touchscreens.
// False on phones and tablets without a pointing device, which are also the devices with no
// physical keyboard. See docs/student-guide.md "Devices".
function hasFinePointer() {
  return !!(window.matchMedia && window.matchMedia("(any-pointer: fine)").matches);
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
// Test-only: `?condition=N` (1-4) forces the condition during emulator runs. Ignored in live runs.
const FORCED_CONDITION = USE_EMULATOR ? [1, 2, 3, 4].find((c) => String(c) === URL_PARAMS.get("condition")) : undefined;

// ---------------------------------------------------------------------------
// Boot: connect the saver first so even a crash in the first trial gets logged.
// ---------------------------------------------------------------------------
(async function main() {
  const deviceSupported = !EXPERIMENT.requires_keyboard || hasFinePointer();

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

  // Random assignment to one of four between-subjects conditions, recorded on every trial and
  // on the participant document. (For exact counterbalancing you would need a server; random
  // assignment is fine at course sample sizes.) `condition` is the number 1-4; `prime` and
  // `sheet` spell out its two components so the analysis never has to decode the number.
  const CONDITIONS = {
    1: { prime: "high_power", sheet: "feedback" },
    2: { prime: "low_power", sheet: "feedback" },
    3: { prime: "none", sheet: "feedback" },
    4: { prime: "none", sheet: "blank" },
  };
  const condition = FORCED_CONDITION || jsPsych.randomization.sampleWithoutReplacement([1, 2, 3, 4], 1)[0];
  const { prime, sheet } = CONDITIONS[condition];
  jsPsych.data.addProperties({ condition: condition, prime: prime, sheet: sheet });
  saver.updateParticipant({ condition: condition, prime: prime, sheet: sheet });
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
       <p>On each screen you will see five words. Please type a sentence that uses four of them.</p>`,
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
              <td><input type="number" name="interesting" min="1" max="11" step="1" aria-label="Interesting (1 to 11)"></td>
              <td><input type="number" name="enjoyable" min="1" max="11" step="1" aria-label="Enjoyable (1 to 11)"></td>
              <td><input type="text" name="comments" aria-label="Comments" autocomplete="off"></td>
            </tr>
          </tbody>
        </table>
      </div>`,
    data: { task: "evaluation_sheet", rows_shown: shownRows.length, own_row: OWN_ROW_NUMBER },
    on_finish: (data) => {
      const toRating = (v) => (v === "" || v === undefined ? null : Number(v));
      data.interesting = toRating(data.response.interesting);
      data.enjoyable = toRating(data.response.enjoyable);
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
        <p>You will receive $10 for your participation in this study. If you have any further
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
    demographics,
    debrief,
  ]);
})();
