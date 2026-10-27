// End-to-end test: a robot participant runs the whole experiment.
//
// Two modes:
//   - Emulator mode (EMULATOR=1, set automatically by `npm test`): data must land in the
//     local Firestore emulator, the security rules must reject forbidden requests, and
//     client errors must be logged.
//   - Offline mode (plain `npx playwright test`): the experiment must still run to the end
//     and offer the JSON download fallback.
//
// If you change the timeline in experiment.js, update `runThroughExperiment` below so the
// robot still knows which buttons to press. That is a feature: the test documents the flow.

const { test, expect, devices } = require("@playwright/test");

const EMULATOR = process.env.EMULATOR === "1" || !!process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT = "demo-psych251";
const EXPERIMENT_ID = "galinsky2008-final";
const FS = `http://localhost:8080/v1/projects/${PROJECT}/databases/(default)/documents`;

const N_SENTENCE_SETS = 20;
const LONG_ESSAY = "Robot participant recalls an incident. ".repeat(8); // > 200 characters
const robotSentence = (setNumber) => "robot sentence " + setNumber;
const DECLINED_SET = 2; // the robot ticks "I'd prefer not to answer" on this sentence set

// Plays the whole study in whatever condition the page assigned (window.__condition), which
// must be 1 or 2: conditions 3 and 4 are still in experiment.js but are no longer assigned.
// The branches below for 3 and 4 are kept so they work again if those conditions return.
// With { stopBeforeFinish: true } it stops on the debrief screen without clicking Finish.
// With { declineEssay: true } it writes a short essay, then declines instead of finishing it.
async function runThroughExperiment(page, { stopBeforeFinish = false, declineEssay = false } = {}) {
  // 1. consent
  await page.getByRole("button", { name: "I agree to participate" }).click();
  const condition = await page.evaluate(() => window.__condition);
  expect([1, 2]).toContain(condition);
  // 2. welcome (one page)
  await expect(page.getByText("Some will ask about your perceptions", { exact: false })).toBeVisible();
  await page.locator("#jspsych-instructions-next").click();
  // 3. power prime, conditions 1 and 2 only: a short essay is refused, a long one accepted
  if (condition === 1 || condition === 2) {
    const essay = page.locator("textarea");
    const counter = page.locator('[data-name="essay"] .sd-question__description');
    await expect(counter).toHaveText("0 / 200 characters minimum");
    await essay.fill("Too short.");
    await expect(counter).toHaveText("10 / 200 characters minimum");
    await page.locator('input[value="Continue"]').click();
    await expect(page.getByText("Please write at least 200 characters.").first()).toBeVisible();
    if (declineEssay) {
      // Declining hides the box and lifts the requirement; the partial text is not saved.
      await page.getByText("I'd prefer not to answer", { exact: true }).click();
      await expect(essay).toHaveCount(0);
    } else {
      await essay.fill(LONG_ESSAY);
      await expect(counter).toContainText(`✓ ${LONG_ESSAY.length} characters`);
    }
    await page.locator('input[value="Continue"]').click();
  }
  // 4. sentence task: one instructions page (pilot-test cover story), then 20 sets
  await expect(page.getByText("psycholinguistic decision-making processes", { exact: false })).toBeVisible();
  await page.locator("#jspsych-instructions-next").click();
  for (let i = 1; i <= N_SENTENCE_SETS; i++) {
    const set = page.locator(`.sentence-set[data-set="${i}"]`);
    await set.waitFor({ state: "visible" });
    if (i === 1) {
      // An empty sentence is refused and the set stays on screen.
      await page.locator("#jspsych-survey-html-form-next").click();
      await expect(set).toBeVisible();
      await expect(page.locator("#sentence-error")).toBeVisible();
      await page.locator("#sentence").fill("x");
      await expect(page.locator("#sentence-error")).toBeHidden();
    }
    if (i === DECLINED_SET) {
      // Declining lifts the requirement: an empty box can be submitted.
      await page.locator("#sentence-declined").check();
      await expect(page.locator("#sentence")).toBeDisabled();
    } else {
      await page.locator("#sentence").fill(robotSentence(i));
    }
    await page.locator("#jspsych-survey-html-form-next").click();
    await set.waitFor({ state: "detached" });
  }
  // 5. evaluation sheet: 10 previous rows in conditions 1-3, none in condition 4
  const sheet = page.locator(".feedback-sheet");
  await sheet.waitFor({ state: "visible" });
  await expect(sheet.locator(".previous-row")).toHaveCount(condition === 4 ? 0 : 10);
  await expect(sheet.locator(".own-row td").first()).toHaveText("29");
  await sheet.locator('input[name="interesting"]').fill("3");
  await sheet.locator('input[name="enjoyable"]').fill("4");
  await sheet.locator('input[name="comments"]').fill("robot comment");
  await page.locator("#jspsych-survey-html-form-next").click();
  // 6. suspicion (two optional free-text questions)
  await page.locator('[data-name="suspicion_purpose"] textarea').fill("Robot thinks it was about sentences.");
  await page.locator('[data-name="suspicion_strange"] textarea').fill("Robot suspects nothing.");
  await page.locator('input[value="Continue"]').click();
  // 7. demographics (SurveyJS)
  await page.locator('input[type="number"]').fill("34");
  await page.getByText("Woman", { exact: true }).click();
  // SurveyJS boolean switches render "Yes" twice once toggled; scope to the question.
  await page.locator('[data-name="native_english"]').getByText("Yes", { exact: true }).first().click();
  await page.locator('input[value="Continue"]').click();
  // 8. debrief: the second paragraph depends on the condition
  const finish = page.getByRole("button", { name: "Finish" });
  await finish.waitFor({ state: "visible" });
  const debrief = page.locator(".debrief");
  const sawSheet = "You then saw a sheet that showed you what fellow participants thought";
  const blankSheet = "Your sheet was left blank";
  const highEssay = "describe a time when you had power over someone else";
  const lowEssay = "describe a time when someone else had power over you";
  const expected = {
    1: [highEssay, sawSheet], 2: [lowEssay, sawSheet], 3: [sawSheet], 4: [blankSheet],
  }[condition];
  await expect(debrief).toContainText("$8 per hour");
  await expect(debrief).toContainText("within a week of completing the study");
  for (const text of [sawSheet, blankSheet, highEssay, lowEssay]) {
    if (expected.includes(text)) await expect(debrief).toContainText(text);
    else await expect(debrief).not.toContainText(text);
  }
  if (stopBeforeFinish) return condition;
  await finish.click();
  await expect(page.getByText("All done")).toBeVisible({ timeout: 30000 });
  return condition;
}

async function fsGet(path) {
  // "Bearer owner" is the emulator's admin token: it bypasses security rules, like the Admin SDK.
  const r = await fetch(`${FS}/${path}`, { headers: { Authorization: "Bearer owner" } });
  return { status: r.status, body: r.status === 200 ? await r.json() : null };
}

// Unwrap Firestore REST "fields" encoding into plain JS.
function decode(v) {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("mapValue" in v) return decodeFields(v.mapValue.fields || {});
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decode);
  return v;
}
function decodeFields(fields) {
  const out = {};
  for (const k of Object.keys(fields)) out[k] = decode(fields[k]);
  return out;
}

test.describe("experiment", () => {
  test("runs to the end and saves data", async ({ page }) => {
    test.setTimeout(240000);
    const consoleErrors = [];
    page.on("pageerror", (e) => consoleErrors.push(String(e)));

    // Emulator runs force each assigned condition (1 and 2) in turn; offline runs one random one.
    const conditions = EMULATOR ? [1, 2] : [null];
    for (const forced of conditions) {
      await page.goto(EMULATOR
        ? `/?emulator=1&condition=${forced}&PROLIFIC_PID=robot123&STUDY_ID=s1&SESSION_ID=sess1`
        : "/");
      await page.waitForFunction(() => window.__saver && window.__saver.uid);
      const mode = await page.evaluate(() => window.__saver.mode);
      expect(mode).toBe(EMULATOR ? "emulator" : "offline");

      // Condition 2 declines the essay, so both paths through the prime are checked.
      const condition = await runThroughExperiment(page, { declineEssay: forced === 2 });
      if (forced) expect(condition).toBe(forced);

      // No uncaught errors from the experiment itself.
      expect(consoleErrors, "uncaught page errors").toEqual([]);

      const uid = await page.evaluate(() => window.__saver.docId);
      const stats = await page.evaluate(() => window.__saver.stats);

      if (!EMULATOR) {
        // Offline: banner + download fallback, nothing else to check.
        await expect(page.locator("#data-saver-banner")).toHaveAttribute("data-kind", "offline");
        await expect(page.locator("#data-saver-fallback")).toBeVisible();
        return;
      }

      expect(stats.writes_failed).toBe(0);
      await expect(page.locator("#data-saver-fallback")).toHaveCount(0);

      // Participant document is complete and carries condition + Prolific ids.
      const p = await fsGet(`experiments/${EXPERIMENT_ID}/participants/${uid}`);
      expect(p.status).toBe(200);
      const pdoc = decodeFields(p.body.fields);
      expect(pdoc.completed).toBe(true);
      const expected = {
        1: { prime: "high_power", sheet: "feedback" },
        2: { prime: "low_power", sheet: "feedback" },
        3: { prime: "none", sheet: "feedback" },
        4: { prime: "none", sheet: "blank" },
      }[condition];
      expect(pdoc.condition).toBe(condition);
      expect(pdoc.prime).toBe(expected.prime);
      expect(pdoc.sheet).toBe(expected.sheet);
      expect(pdoc.prolific_pid).toBe("robot123");
      expect(pdoc.n_trials).toBeGreaterThan(20);
      expect(typeof pdoc.full_data).toBe("string");
      const full = JSON.parse(pdoc.full_data);
      expect(full.length).toBe(pdoc.n_trials);

      // One chunk per trial (chunk_size = 1), each carrying the trial data.
      const chunks = await fsGet(`experiments/${EXPERIMENT_ID}/participants/${uid}/trials?pageSize=500`);
      expect(chunks.status).toBe(200);
      const docs = (chunks.body.documents || []).map((d) => decodeFields(d.fields));
      expect(docs.length).toBe(pdoc.n_trials);
      const trials = docs.flatMap((d) => d.trials).sort((x, y) => x.trial_index - y.trial_index);
      expect(trials.every((t) => t.condition === condition && t.prime === expected.prime)).toBe(true);

      // Power prime: only in conditions 1 and 2, with the essay logged.
      const primeRows = trials.filter((t) => t.task === "power_prime");
      if (expected.prime === "none") {
        expect(primeRows.length).toBe(0);
      } else {
        expect(primeRows.length).toBe(1);
        if (condition === 2) {
          expect(primeRows[0].declined).toBe(true);
          expect(primeRows[0].essay).toBe("");
          expect(primeRows[0].essay_chars).toBe(0);
        } else {
          expect(primeRows[0].declined).toBe(false);
          expect(primeRows[0].essay).toBe(LONG_ESSAY);
          expect(primeRows[0].essay_chars).toBeGreaterThanOrEqual(200);
        }
      }

      // Sentence task: 20 sets in fixed order, each with its sentence and timestamps.
      const sentences = trials.filter((t) => t.task === "sentence_formation");
      expect(sentences.length).toBe(N_SENTENCE_SETS);
      expect(sentences.map((t) => t.set_number)).toEqual([...Array(N_SENTENCE_SETS).keys()].map((i) => i + 1));
      expect(sentences[0].words).toBe("dog the barked loudly yellow");
      expect(sentences[19].words).toBe("clock the ticks loudly wall");
      for (const t of sentences) {
        expect(t.declined).toBe(t.set_number === DECLINED_SET);
        expect(t.sentence).toBe(t.set_number === DECLINED_SET ? null : robotSentence(t.set_number));
        expect(typeof t.rt).toBe("number");
        expect(Date.parse(t.submit_time)).toBeGreaterThanOrEqual(Date.parse(t.onset_time));
      }

      // Evaluation sheet: both ratings and the comment, and which version of the sheet.
      const evalRow = trials.find((t) => t.task === "evaluation_sheet");
      expect(evalRow.interesting).toBe(3);
      expect(evalRow.enjoyable).toBe(4);
      expect(evalRow.sheet_comment).toBe("robot comment");
      expect(evalRow.rows_shown).toBe(expected.sheet === "feedback" ? 10 : 0);

      const susp = trials.find((t) => t.task === "suspicion");
      expect(susp.response.suspicion_purpose).toBe("Robot thinks it was about sentences.");
      expect(susp.response.suspicion_strange).toBe("Robot suspects nothing.");
      const demo = trials.find((t) => t.task === "demographics");
      expect(demo.response.age).toBe(34);

      // Every trial row must carry the same participant id as its participant document,
      // otherwise trials.csv and participants.csv cannot be joined in the analysis.
      expect([...new Set(trials.map((t) => t.participant_id))]).toEqual([uid]);
    }
  });

  test("random assignment uses only conditions 1 and 2, and both occur", async ({ page }) => {
    // 20 page loads: the chance that a fair coin never gives one of the two is about 1 in 500,000.
    // `?condition=3` must not force an unassigned condition: it falls back to random assignment.
    test.setTimeout(120000);
    const seen = [];
    for (let i = 0; i < 20; i++) {
      await page.goto(EMULATOR ? (i === 0 ? "/?emulator=1&condition=3" : "/?emulator=1") : "/");
      await page.waitForFunction(() => window.__condition !== undefined);
      seen.push(await page.evaluate(() => window.__condition));
    }
    expect(seen.every((c) => c === 1 || c === 2), `assigned: ${seen.join(",")}`).toBe(true);
    expect(new Set(seen).size, `assigned: ${seen.join(",")}`).toBe(2);
  });

  test("chunked writes (chunk_size > 1) save every trial", async ({ page }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    await page.goto("/?emulator=1&chunk_size=5");
    await page.waitForFunction(() => window.__saver && window.__saver.uid);
    await runThroughExperiment(page);
    const uid = await page.evaluate(() => window.__saver.docId);
    const p = decodeFields((await fsGet(`experiments/${EXPERIMENT_ID}/participants/${uid}`)).body.fields);
    const chunks = await fsGet(`experiments/${EXPERIMENT_ID}/participants/${uid}/trials?pageSize=500`);
    const docs = (chunks.body.documents || []).map((d) => decodeFields(d.fields));
    expect(docs.length).toBe(Math.ceil(p.n_trials / 5));
    const indices = docs.flatMap((d) => d.trials).map((t) => t.trial_index).sort((a, b) => a - b);
    // Compare with the full dataset rather than 0..n-1: jsPsych still uses up a trial_index
    // for a conditional trial that is skipped (the power prime in conditions 3 and 4).
    expect(indices).toEqual(JSON.parse(p.full_data).map((t) => t.trial_index).sort((a, b) => a - b));
    expect(new Set(indices).size).toBe(p.n_trials);
  });

  test("declining consent ends the study without a thank-you-for-your-data message", async ({ page }) => {
    await page.goto(EMULATOR ? "/?emulator=1" : "/");
    await page.waitForFunction(() => window.__saver && window.__saver.uid);
    await page.getByRole("button", { name: "I do not agree" }).click();
    await expect(page.getByText("You chose not to participate")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Your responses were saved")).toHaveCount(0);
  });

  test("losing the connection at the end offers the download fallback instead of hanging", async ({ page, context }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    test.setTimeout(120000);
    // Run the real flow up to the last click, then cut the connection before "Finish".
    await page.goto("/?emulator=1");
    await page.waitForFunction(() => window.__saver && window.__saver.uid);
    await runThroughExperiment(page, { stopBeforeFinish: true });
    await context.setOffline(true);
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page.locator("#data-saver-fallback")).toBeVisible({ timeout: 40000 });
    await expect(page.getByText("connection to the server was lost")).toBeVisible();
    await expect(page.getByText("Your responses were saved")).toHaveCount(0);
    await context.setOffline(false);
  });

  test("a second run in the same browser is a new participant and saves cleanly", async ({ page }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    test.setTimeout(120000);

    const ids = [];
    for (let run = 0; run < 2; run++) {
      // Same page/context both times: the anonymous auth session persists, exactly as it
      // does for a student testing twice in one browser or a participant who reloads.
      await page.goto("/?emulator=1&PROLIFIC_PID=rerun" + run);
      await page.waitForFunction(() => window.__saver && window.__saver.docId);
      await runThroughExperiment(page);
      const info = await page.evaluate(() => ({
        uid: window.__saver.uid, docId: window.__saver.docId, stats: window.__saver.stats,
      }));
      expect(info.stats.writes_failed, "run " + run + " had failed writes").toBe(0);
      await expect(page.locator("#data-saver-fallback")).toHaveCount(0);
      ids.push(info);
    }

    expect(ids[0].uid).toBe(ids[1].uid);          // same browser, same anonymous identity
    expect(ids[0].docId).not.toBe(ids[1].docId);  // but a separate participant record

    // Both runs survive intact, with their own Prolific id and their own trials.
    for (let run = 0; run < 2; run++) {
      const p = await fsGet(`experiments/${EXPERIMENT_ID}/participants/${ids[run].docId}`);
      expect(p.status).toBe(200);
      const pdoc = decodeFields(p.body.fields);
      expect(pdoc.completed, "run " + run + " completed").toBe(true);
      expect(pdoc.prolific_pid).toBe("rerun" + run);
      const chunks = await fsGet(`experiments/${EXPERIMENT_ID}/participants/${ids[run].docId}/trials?pageSize=500`);
      expect((chunks.body.documents || []).length).toBe(pdoc.n_trials);
    }
  });

  test("setting a Prolific completion code does not break the test run", async ({ page }) => {
    // Regression test for the failure students hit right before launch: with a completion
    // code set, the live page redirects to Prolific, but a test run must stay put so that
    // `npm test` and CI keep passing.
    const navigations = [];
    page.on("framenavigated", (f) => { if (f === page.mainFrame()) navigations.push(f.url()); });

    await page.goto(EMULATOR ? "/?emulator=1&cc=QA123CODE" : "/?cc=QA123CODE");
    await page.waitForFunction(() => window.__saver && window.__saver.docId);
    await runThroughExperiment(page);

    expect(navigations.some((u) => u.includes("prolific.com")), "must not navigate to Prolific").toBe(false);
    if (EMULATOR) await expect(page.getByText("QA123CODE")).toBeVisible();
  });

  test("phones and tablets are turned away before consent", async ({ browser }) => {
    // The Android phone reproduces one that got through in Pilot A: its user agent and screen,
    // and a browser that reports a fine pointer among its inputs (any-pointer: fine) although
    // the touchscreen is primary. The old check let it through and the page then crashed.
    const pilotAndroid = {
      userAgent: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36",
      viewport: { width: 384, height: 832 }, deviceScaleFactor: 2.8125, isMobile: true, hasTouch: true,
    };
    const phones = [
      { name: "iPhone 13", options: devices["iPhone 13"] },
      { name: "Pilot A Android phone", options: pilotAndroid, anyPointerFine: true },
    ];
    for (const phone of phones) {
      const context = await browser.newContext(phone.options);
      if (phone.anyPointerFine) {
        await context.addInitScript(() => {
          const real = window.matchMedia.bind(window);
          window.matchMedia = (q) => (/any-pointer:\s*fine/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : real(q));
        });
      }
      const page = await context.newPage();
      const pageErrors = [];
      page.on("pageerror", (e) => pageErrors.push(String(e)));
      await page.goto("http://localhost:8017/?emulator=1");
      await expect(page.locator("#device-unsupported"), phone.name).toBeVisible({ timeout: 20000 });
      await expect(page.getByRole("button", { name: "I agree to participate" })).toHaveCount(0);
      expect(pageErrors, `${phone.name}: uncaught page errors`).toEqual([]);

      if (EMULATOR) {
        // The turned-away visit is still recorded, so phone traffic is visible in the data.
        await page.waitForFunction(() => window.__saver && window.__saver.docId);
        const docId = await page.evaluate(() => window.__saver.docId);
        await page.evaluate(() => window.__saver._settle());
        const p = await fsGet(`experiments/${EXPERIMENT_ID}/participants/${docId}`);
        const pdoc = decodeFields(p.body.fields);
        expect(pdoc.device_supported, phone.name).toBe(false);
        expect(pdoc.completed).toBe(false);
      }
      await context.close();
    }
  });

  test("a desktop browser is not turned away", async ({ page }) => {
    await page.goto(EMULATOR ? "/?emulator=1" : "/");
    await expect(page.getByRole("button", { name: "I agree to participate" })).toBeVisible();
    await expect(page.locator("#device-unsupported")).toHaveCount(0);
  });

  test("a write the database refuses is announced on the page, not only in the console", async ({ page }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    // Regression test for the state a student is in when they skip publishing the rules, or
    // once test-mode rules expire: sign-in succeeds, so the page used to look perfectly
    // healthy from consent to debrief and only admitted the problem on the last screen.
    await page.goto("/?emulator=1");
    await page.waitForFunction(() => window.__saver && window.__saver.docId);
    // Emulator runs carry an informational banner; what must be absent is a failure banner.
    await expect(page.locator('#data-saver-banner[data-kind="offline"]')).toHaveCount(0);

    // Force a genuine permission-denied on a normal save path by aiming the participant
    // document at someone else's id, which the rules refuse exactly as deny-all rules would.
    await page.evaluate(async () => {
      window.__saver.docId = "someone-else-deadbeef";
      await window.__saver.updateParticipant({ blocked: true });
    });

    const banner = page.locator("#data-saver-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("data-kind", "offline");
    await expect(banner).toContainText("NOT being saved");
    await expect(banner).toContainText("permission-denied");
    await expect(banner).toContainText("2.3");
    expect(await page.evaluate(() => window.__saver.stats.writes_failed)).toBeGreaterThan(0);
  });

  test("the download fallback tells the participant where to send the file", async ({ page }) => {
    await page.goto(EMULATOR ? "/?emulator=1" : "/");
    await page.waitForFunction(() => window.__saver && window.__saver.docId);
    await page.evaluate(() => window.__saver._offerDownload(null, "[]"));
    const box = page.locator("#data-saver-fallback");
    await expect(box).toBeVisible();
    await expect(box).toContainText("@");                       // a contact address is present
    await expect(box).toContainText("you will be paid");
    await expect(box.getByRole("link")).toHaveAttribute("href", /^mailto:/);
  });

  test("security rules reject reads and writes to other participants", async ({ page }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    await page.goto("/?emulator=1");
    await page.waitForFunction(() => window.__saver && window.__saver.uid);

    const results = await page.evaluate(async () => {
      const s = window.__saver;
      const fb = s.fb;
      const out = {};
      const attempt = async (name, fn) => {
        try { await fn(); out[name] = "allowed"; } catch (e) { out[name] = e.code || e.message; }
      };
      await attempt("read own doc", () =>
        fb.getDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", s.docId)));
      await attempt("write other participant", () =>
        fb.setDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", "someone-else"), { hacked: true }));
      await attempt("write other participant trials", () =>
        fb.setDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", "someone-else", "trials", "c0"), { trials: [] }));
      await attempt("write unrelated collection", () =>
        fb.setDoc(fb.doc(s.db, "spam", "doc"), { spam: true }));
      await attempt("error doc with wrong uid", () =>
        fb.addDoc(fb.collection(s.db, "experiments", s.opts.experiment_id, "errors"), { uid: "not-me", message: "x" }));
      await attempt("own chunk (should be allowed)", () =>
        fb.setDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", s.docId, "trials", "chunk-test"), { trials: [{ a: 1 }] }));
      await attempt("participant doc without the run suffix", () =>
        fb.setDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", s.uid), { sneaky: true }));
      await attempt("another browser's run id", () =>
        fb.setDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", "someone-else-abcd1234"), { sneaky: true }));
      return out;
    });

    expect(results["read own doc"]).toBe("permission-denied");
    expect(results["write other participant"]).toBe("permission-denied");
    expect(results["write other participant trials"]).toBe("permission-denied");
    expect(results["write unrelated collection"]).toBe("permission-denied");
    expect(results["error doc with wrong uid"]).toBe("permission-denied");
    expect(results["own chunk (should be allowed)"]).toBe("allowed");
    expect(results["participant doc without the run suffix"]).toBe("permission-denied");
    expect(results["another browser's run id"]).toBe("permission-denied");
  });

  test("uncaught errors are logged to the errors collection", async ({ page }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    await page.goto("/?emulator=1");
    await page.waitForFunction(() => window.__saver && window.__saver.uid);
    const uid = await page.evaluate(() => window.__saver.uid);

    // Simulate a bug in a trial: an uncaught exception.
    await page.evaluate(() => {
      setTimeout(() => { throw new Error("simulated bug in trial code"); }, 0);
    });
    await page.waitForFunction(() => window.__saver.stats.errors_logged >= 1);
    await page.evaluate(() => new Promise((r) => setTimeout(r, 1500)));

    const errs = await fsGet(`experiments/${EXPERIMENT_ID}/errors?pageSize=100`);
    const mine = (errs.body.documents || []).map((d) => decodeFields(d.fields)).filter((d) => d.uid === uid);
    expect(mine.length).toBe(1);
    expect(mine[0].message).toContain("simulated bug");
    expect(mine[0].context.kind).toBe("uncaught");
  });
});
