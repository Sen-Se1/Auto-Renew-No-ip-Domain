require("dotenv").config();
const express = require("express");
const { chromium } = require("playwright-core");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3002;
const CDP_URL = process.env.CDP_URL || "http://192.168.1.100:9223";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const WIT_AI_TOKEN = process.env.WIT_AI_TOKEN || "";
const START_BROWSER_SCRIPT =
  process.env.START_BROWSER_SCRIPT || "/app/scripts/start-browser.sh";
const REMOVE_BROWSER_SCRIPT =
  process.env.REMOVE_BROWSER_SCRIPT || "/app/scripts/remove-browser.sh";
 
let browser = null;
let page = null;

// ─────────────────────────────────────────────
// Docker / browser container helpers
// ─────────────────────────────────────────────

async function runScript(script, label) {
  console.log(`\n▶️ Running ${label}`);
  console.log(`   Script: ${script}`);

  try {
    const { stdout, stderr } = await execFileAsync("/bin/sh", [script], {
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (stdout) {
      console.log(`[${label}] stdout:`);
      console.log(stdout);
    }

    if (stderr) {
      console.log(`[${label}] stderr:`);
      console.log(stderr);
    }

    console.log(`✅ ${label} completed`);

    return {
      success: true,
      stdout,
      stderr,
    };
  } catch (error) {
    console.error(`❌ ${label} failed: ${error.message}`);

    if (error.stdout) {
      console.error(`[${label}] stdout:`);
      console.error(error.stdout);
    }

    if (error.stderr) {
      console.error(`[${label}] stderr:`);
      console.error(error.stderr);
    }

    throw new Error(`${label} failed: ${error.message}`);
  }
}

async function startBrowserContainers() {
  return runScript(START_BROWSER_SCRIPT, "start-browser.sh");
}

async function removeBrowserContainers() {
  try {
    return await runScript(REMOVE_BROWSER_SCRIPT, "remove-browser.sh");
  } catch (error) {
    // Cleanup failure should not hide the original /confirm-noip result
    console.error(`⚠️ Browser cleanup failed: ${error.message}`);

    return {
      success: false,
      error: error.message,
    };
  }
}

// ─────────────────────────────────────────────
// Wait for Chromium CDP
// ─────────────────────────────────────────────

async function waitForBrowser(maxAttempts = 30) {
  console.log(`\n⏳ Waiting for Chromium CDP: ${CDP_URL}`);

  for (let i = 1; i <= maxAttempts; i++) {
    let testBrowser = null;

    try {
      console.log(`   Checking CDP... ${i}/${maxAttempts}`);

      testBrowser = await chromium.connectOverCDP(CDP_URL);

      console.log("✅ Chromium CDP is ready");

      await testBrowser.close();

      return true;
    } catch (error) {
      if (testBrowser) {
        try {
          await testBrowser.close();
        } catch {}
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  throw new Error(
    `Chromium CDP did not become available after ${maxAttempts} seconds: ${CDP_URL}`,
  );
}

// ─────────────────────────────────────────────
// Helpers – comportement humain
// ─────────────────────────────────────────────

/** Délai aléatoire entre min et max ms */
function randomDelay(min = 300, max = 900) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((r) => setTimeout(r, ms));
}

/** Déplace la souris vers (x, y) en plusieurs étapes naturelles */
async function humanMouseMove(page, x, y) {
  const steps = Math.floor(Math.random() * 8) + 6; // 6 à 13 étapes
  await page.mouse.move(x, y, { steps });
}

/** Clic humain sur un locator Playwright */
async function humanClick(page, target) {
  const box = await target.boundingBox();
  if (!box) throw new Error("Élément non visible pour le clic humain");
  // Légère variation aléatoire autour du centre de l'élément
  const cx = box.x + box.width / 2 + (Math.random() * 6 - 3);
  const cy = box.y + box.height / 2 + (Math.random() * 4 - 2);
  await humanMouseMove(page, cx, cy);
  await randomDelay(100, 300);
  await page.mouse.down();
  await randomDelay(60, 150);
  await page.mouse.up();
}

// ─────────────────────────────────────────────
// Connexion au navigateur distant via CDP
// ─────────────────────────────────────────────

async function getPage() {
  if (!browser) {
    console.log(`Connecting to Chromium (${CDP_URL})...`);
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log("Connected to Chromium");
  }
  const contexts = browser.contexts();
  if (contexts.length === 0) throw new Error("No browser context found");
  const context = contexts[0];
  const pages = context.pages();
  page = pages.length > 0 ? pages[0] : await context.newPage();
  return page;
}

// ─────────────────────────────────────────────
// Service Audio reCAPTCHA gratuit (Option 2 - Speech-to-Text)
// ─────────────────────────────────────────────

async function solveRecaptchaAudio(page, label = "") {
  try {
    console.log(
      `🎙️  [${label}] Recherche de l'iframe de challenge reCAPTCHA...`,
    );

    // Attendre l'iframe bframe (challenge)
    const bframeLocator = page
      .frameLocator(
        'iframe[src*="recaptcha/api2/bframe"], iframe[src*="recaptcha/enterprise/bframe"]',
      )
      .first();

    // Clic sur l'icône Audio (#recaptcha-audio-button)
    const audioBtn = bframeLocator.locator("#recaptcha-audio-button");
    const canClickAudio = await audioBtn
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (!canClickAudio) {
      console.log(
        `⚠️  [${label}] Bouton Audio non trouvé dans l'iframe de challenge.`,
      );
      return false;
    }

    await humanClick(page, audioBtn);
    console.log(`🖱️  [${label}] Bouton Challenge Audio cliqué !`);
    await randomDelay(2000, 3000);

    // Vérifier si Google bloque l'audio ("Your computer or network may be sending automated queries")
    const isBlocked = await bframeLocator
      .locator(".rc-doodle-default, .rc-audiochallenge-error-message")
      .isVisible()
      .catch(() => false);
    if (isBlocked) {
      console.log(
        `⚠️  [${label}] Google a temporairement bloqué les requêtes audio sur cette IP.`,
      );
      return false;
    }

    // Récupérer le lien de téléchargement audio MP3 (.rc-audiochallenge-tdownload-link) ou l'élément audio (#audio-source)
    const downloadLink = bframeLocator
      .locator(".rc-audiochallenge-tdownload-link, audio#audio-source")
      .first();
    await downloadLink.waitFor({ state: "attached", timeout: 10000 });

    const audioUrl = await downloadLink.evaluate((el) => el.href || el.src);
    if (!audioUrl) {
      console.log(
        `❌ [${label}] Impossible de récupérer l'URL du fichier audio.`,
      );
      return false;
    }

    console.log(`📥 [${label}] Téléchargement du fichier audio...`);
    const audioBuffer = await fetch(audioUrl).then((r) => r.arrayBuffer());
    const base64Audio = Buffer.from(audioBuffer).toString("base64");

    console.log(`🧠 [${label}] Reconnaissance vocale avec Google Gemini IA...`);
    let text = "";

    // ── Source 1 : Google Gemini API (Ultra rapide & gratuit) ─────────────
    if (GEMINI_API_KEY) {
      // Liste des modèles Gemini par ordre de priorité
      const models = [
        "gemini-2.5-flash",
        "gemini-2.0-flash",
        "gemini-1.5-flash",
      ];
      for (const model of models) {
        try {
          const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [
                  {
                    parts: [
                      {
                        inline_data: {
                          mime_type: "audio/mp3",
                          data: base64Audio,
                        },
                      },
                      {
                        text: "Listen to this reCAPTCHA audio challenge. Transcribe ONLY the numbers or words spoken. Output nothing else, no punctuation, no extra words.",
                      },
                    ],
                  },
                ],
              }),
            },
          ).then((r) => r.json());

          if (geminiRes?.candidates?.[0]?.content?.parts?.[0]?.text) {
            text = geminiRes.candidates[0].content.parts[0].text.trim();
            console.log(`✨ [${label}] Transcrit par ${model} : "${text}"`);
            break;
          } else if (geminiRes?.error) {
            console.log(
              `  └ ${model} indisponible : ${geminiRes.error.message.split("\n")[0]}`,
            );
          }
        } catch (e) {
          console.log(`  └ Erreur ${model} : ${e.message}`);
        }
      }
    } else {
      console.log(
        `ℹ️  [${label}] GEMINI_API_KEY non fournie. Passage aux modèles de secours...`,
      );
    }

    // ── Source 2 : HuggingFace Whisper (Fallback 1) ──────────────────────
    if (!text) {
      try {
        const hfRes = await fetch(
          "https://api-inference.huggingface.co/models/openai/whisper-large-v3-turbo",
          {
            method: "POST",
            headers: { "Content-Type": "audio/mpeg" },
            body: Buffer.from(audioBuffer),
          },
        ).then((r) => r.json());

        if (hfRes && hfRes.text) {
          text = hfRes.text.trim();
          console.log(`🎯 [${label}] Transcrit via Whisper : "${text}"`);
        }
      } catch (e) {}
    }

    // ── Source 3 : Wit.ai API Speech ─────────────────────────────
    if (!text && WIT_AI_TOKEN) {
      try {
        const witRes = await fetch("https://api.wit.ai/speech", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${WIT_AI_TOKEN}`,
            "Content-Type": "audio/mpeg",
          },
          body: Buffer.from(audioBuffer),
        }).then((r) => r.json());

        if (witRes && witRes.text) {
          text = witRes.text.trim();
          console.log(`🎯 [${label}] Transcrit via Wit.ai : "${text}"`);
        }
      } catch (e) {
        console.log(`  └ Erreur Source 3 : ${e.message}`);
      }
    }

    // Nettoyage du texte (chiffres et lettres uniquement)
    if (text) {
      text = text.replace(/[^a-zA-Z0-9\s]/g, "").trim();
    }

    if (!text) {
      console.log(
        `❌ [${label}] Échec de la transcription audio sur toutes les sources.`,
      );
      return false;
    }

    console.log(`🎯 [${label}] Mots reconnus : "${text}"`);

    // Saisir le texte dans le champ #audio-response
    const responseInput = bframeLocator.locator("#audio-response");
    await responseInput.fill(text);
    await randomDelay(500, 1000);

    // Cliquer sur le bouton Vérifier (#recaptcha-verify-button)
    const verifyBtn = bframeLocator.locator("#recaptcha-verify-button");
    await humanClick(page, verifyBtn);
    console.log(`🖱️  [${label}] Bouton "Vérifier" cliqué !`);
    await randomDelay(3000, 5000);

    // Vérifier si résolu dans la page
    const isSolved = await page.evaluate(() => {
      const ta = document.querySelector(
        'textarea[name="g-recaptcha-response"], #g-recaptcha-response',
      );
      return ta && ta.value && ta.value.length > 10;
    });

    if (isSolved) {
      console.log(`🎯 [${label}] Captcha audio validé avec succès ✅`);
      return true;
    }
  } catch (e) {
    console.log(
      `⚠️  [${label}] Erreur pendant la résolution audio : ${e.message}`,
    );
  }
  return false;
}

// ─────────────────────────────────────────────
// Utilitaire : résoudre un captcha sur la page
// Priorité : hCAPTCHA → reCAPTCHA v2
// Retourne true si un captcha a été trouvé et résolu
// ─────────────────────────────────────────────

async function solveCaptchaOnPage(p, label = "") {
  console.log(`\n🔍 [${label}] Recherche d'un captcha sur la page...`);

  await p.waitForLoadState("networkidle").catch(() => {});
  await randomDelay(1000, 2000);

  // ── hCAPTCHA (priorité 1) ────────────────────────────────────────────
  const hasHcaptcha = await p
    .locator('iframe[src*="hcaptcha"]')
    .count()
    .then((n) => n > 0)
    .catch(() => false);
  if (hasHcaptcha) {
    try {
      const hFrame = p.frameLocator('iframe[src*="hcaptcha"]').first();
      const hCheckbox = hFrame.locator("#checkbox");
      await hCheckbox.waitFor({ state: "visible", timeout: 10000 });

      console.log(`✅ [${label}] hCAPTCHA trouvé – approche humaine...`);
      const box = await hCheckbox.boundingBox().catch(() => null);
      if (box) {
        await humanMouseMove(p, box.x - 180, box.y + 60);
        await randomDelay(400, 700);
        await humanMouseMove(p, box.x + box.width / 2, box.y + box.height / 2);
        await randomDelay(200, 500);
      }

      await humanClick(p, hCheckbox);
      console.log(`🖱️  [${label}] Checkbox hCAPTCHA cliquée !`);
      await randomDelay(2500, 4500);

      const challengeVisible = await p
        .locator('iframe[src*="hcaptcha"][src*="challenge"]')
        .isVisible()
        .catch(() => false);

      if (challengeVisible) {
        console.log(`⚠️  [${label}] Challenge hCAPTCHA – attente max 45s...`);
        await p
          .waitForSelector('iframe[src*="hcaptcha"][src*="challenge"]', {
            state: "hidden",
            timeout: 45000,
          })
          .catch(() =>
            console.log(`⏱️  [${label}] Timeout challenge, on continue...`),
          );
        await randomDelay(1000, 2000);
      }

      console.log(`🎯 [${label}] hCAPTCHA traité ✅`);
      return true;
    } catch (e) {
      console.log(`⚠️  [${label}] Erreur hCAPTCHA : ${e.message}`);
    }
  }

  // ── reCAPTCHA v2 (priorité 2) ────────────────────────────────────────
  const rSelector =
    'iframe[src*="recaptcha/api2/anchor"], iframe[src*="recaptcha/enterprise/anchor"]';
  const hasRecaptcha = await p
    .locator(rSelector)
    .count()
    .then((n) => n > 0)
    .catch(() => false);

  if (!hasRecaptcha) {
    const hasAny = await p
      .locator('iframe[src*="recaptcha"]')
      .count()
      .then((n) => n > 0)
      .catch(() => false);
    if (!hasAny) {
      console.log(`ℹ️  [${label}] Aucun captcha trouvé sur cette page.`);
      return false;
    }
  }

  try {
    await p.waitForSelector('iframe[src*="recaptcha"]', { timeout: 20000 });
    const rFrame = p.frameLocator('iframe[src*="recaptcha"]').first();
    const rCheckbox = rFrame.locator("#recaptcha-anchor");
    await rCheckbox.waitFor({ state: "visible", timeout: 15000 });

    console.log(`✅ [${label}] reCAPTCHA v2 trouvé – approche humaine...`);

    const box = await rCheckbox.boundingBox().catch(() => null);
    if (box) {
      await humanMouseMove(p, box.x - 160, box.y + 50);
      await randomDelay(400, 700);
      await humanMouseMove(p, box.x + box.width / 2, box.y + box.height / 2);
      await randomDelay(200, 500);
    }

    await humanClick(p, rCheckbox);
    console.log(`🖱️  [${label}] Checkbox reCAPTCHA cliquée !`);
    await randomDelay(3000, 5000);

    // Vérification rapide de la résolution automatique par le clic
    let solved = await p
      .waitForFunction(
        () => {
          const ta = document.querySelector(
            'textarea[name="g-recaptcha-response"], #g-recaptcha-response',
          );
          return ta && ta.value && ta.value.length > 10;
        },
        { timeout: 8000 },
      )
      .catch(() => null);

    if (solved) {
      console.log(
        `🎯 [${label}] reCAPTCHA résolu automatiquement (sans challenge) ✅`,
      );
      return true;
    }

    // ── Si un challenge image apparaît, bascule sur la méthode AUDIO GRATUITE ────
    console.log(
      `⚠️  [${label}] Challenge détecté. Bascule sur la méthode Audio Speech-to-Text gratuite...`,
    );
    const audioSolved = await solveRecaptchaAudio(p, label);
    if (audioSolved) return true;

    return true;
  } catch (e) {
    console.log(`⚠️  [${label}] Erreur reCAPTCHA : ${e.message}`);
  }

  console.log(`ℹ️  [${label}] Aucun captcha résolu.`);
  return false;
}

// ─────────────────────────────────────────────
// POST /open  – ouvre une URL
// ─────────────────────────────────────────────

app.post("/open", async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: "url is required",
      });
    }

    // IMPORTANT:
    // Start browser containers BEFORE connecting to CDP.
    console.log("\n🚀 Starting browser containers...");

    const browserStart = await startBrowserContainers();

    // Wait until Chromium exposes CDP
    await waitForBrowser();

    // Reset old Playwright connection
    browser = null;
    page = null;

    console.log(`\n🌐 Opening: ${url}`);

    const p = await getPage();

    await p.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    console.log(`✅ Opened: ${p.url()}`);

    res.json({
      success: true,
      requestedUrl: url,
      currentUrl: p.url(),
      title: await p.title(),
      browserStarted: browserStart.success,
    });
  } catch (error) {
    console.error("❌ /open error:", error);

    browser = null;
    page = null;

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ─────────────────────────────────────────────
// GET /status  – état de la connexion
// ─────────────────────────────────────────────

app.get("/status", async (req, res) => {
  try {
    const p = await getPage();
    res.json({
      success: true,
      connected: true,
      url: p.url(),
      title: await p.title(),
    });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, connected: false, error: error.message });
  }
});

// ─────────────────────────────────────────────
// POST /confirm-noip  – séquence intelligente no-ip
//
//  DÉTECTION AUTOMATIQUE de la page courante :
//
//  CAS A – Page "Confirm hostname" (bouton visible) :
//    1. Cocher hCAPTCHA
//    2. Cliquer "Confirm your hostname now"
//    → redirect → CAS B
//
//  CAS B – Page captcha directe (pas de bouton confirm) :
//    1. Résoudre le captcha
//    2. Soumettre si bouton présent
//
//  Le bot détecte automatiquement dans quel cas il est.
// ─────────────────────────────────────────────

/** Vérifie si le bouton "Confirm your hostname now" est visible */
async function isOnConfirmPage(p) {
  const selectors = [
    'button:has-text("Confirm your hostname now")',
    'input[value*="Confirm your hostname now"]',
    'a:has-text("Confirm your hostname now")',
  ];
  for (const sel of selectors) {
    try {
      const visible = await p
        .locator(sel)
        .first()
        .isVisible({ timeout: 3000 })
        .catch(() => false);
      if (visible) return true;
    } catch {
      /* continuer */
    }
  }
  return false;
}

/** Vérifie si on est sur la page d'upsell "Before Confirming your Hostname" (bouton "No thanks, just renew my free hostname" ou "Confirm My Hostname") */
async function isOnRenewUpsellPage(p) {
  const selectors = [
    'a:has-text("Confirm My Hostname")',
    'button:has-text("Confirm My Hostname")',
    'a:has-text("No thanks, just renew my free hostname")',
    'button:has-text("No thanks, just renew my free hostname")',
    '*:has-text("No thanks, just renew my free hostname")',
    'text="No thanks, just renew my free hostname"',
    'text="Your Action Required: Confirm Your Hostname"'
  ];
  for (const sel of selectors) {
    try {
      const visible = await p
        .locator(sel)
        .first()
        .isVisible({ timeout: 3000 })
        .catch(() => false);
      if (visible) return true;
    } catch {
      /* continuer */
    }
  }
  return false;
}

/** Clique sur "Confirm My Hostname" ou "No thanks, just renew my free hostname" de façon humaine */
async function clickRenewButton(p) {
  const renewSelectors = [
    'a:has-text("Confirm My Hostname")',
    'button:has-text("Confirm My Hostname")',
    'a:has-text("No thanks, just renew my free hostname")',
    'button:has-text("No thanks, just renew my free hostname")',
    '*:has-text("No thanks, just renew my free hostname")',
  ];

  for (const sel of renewSelectors) {
    try {
      const btn = p.locator(sel).first();
      const visible = await btn.isVisible({ timeout: 3000 }).catch(() => false);
      if (!visible) continue;

      console.log(`✅ Bouton renew/confirm trouvé : "${sel}"`);
      const btnBox = await btn.boundingBox().catch(() => null);
      if (btnBox) {
        await humanMouseMove(p, btnBox.x - 100, btnBox.y - 30);
        await randomDelay(400, 800);
        await humanMouseMove(
          p,
          btnBox.x + btnBox.width / 2,
          btnBox.y + btnBox.height / 2,
        );
        await randomDelay(200, 400);
      }
      await humanClick(p, btn);
      console.log('🖱️  Bouton de confirmation cliqué !');
      return true;
    } catch {
      /* prochain */
    }
  }
  return false;
}

/** Clique sur "Confirm your hostname now" de façon humaine */
async function clickConfirmButton(p) {
  const confirmSelectors = [
    'button:has-text("Confirm your hostname now")',
    'input[value*="Confirm your hostname"]',
    'a:has-text("Confirm your hostname")',
    'button:has-text("Confirm")',
    'input[type="submit"]',
    'button[type="submit"]',
  ];

  for (const sel of confirmSelectors) {
    try {
      const btn = p.locator(sel).first();
      const visible = await btn.isVisible({ timeout: 3000 }).catch(() => false);
      if (!visible) continue;

      console.log(`✅ Bouton confirm trouvé : "${sel}"`);
      const btnBox = await btn.boundingBox().catch(() => null);
      if (btnBox) {
        // Approche humaine en 2 mouvements
        await humanMouseMove(p, btnBox.x - 120, btnBox.y - 40);
        await randomDelay(400, 800);
        await humanMouseMove(
          p,
          btnBox.x + btnBox.width / 2,
          btnBox.y + btnBox.height / 2,
        );
        await randomDelay(200, 400);
      }
      await humanClick(p, btn);
      console.log('🖱️  "Confirm your hostname now" cliqué !');
      return true;
    } catch {
      /* prochain */
    }
  }
  return false;
}

/** Clique sur un bouton de soumission générique */
async function clickSubmitButton(p, label = "") {
  const submitSelectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Submit")',
    'button:has-text("Confirm")',
    'button:has-text("Verify")',
    'button:has-text("Continue")',
  ];
  for (const sel of submitSelectors) {
    try {
      const btn = p.locator(sel).first();
      const visible = await btn.isVisible({ timeout: 2000 }).catch(() => false);
      if (visible) {
        console.log(`🖱️  [${label}] Submit : "${sel}"`);
        await humanClick(p, btn);
        return true;
      }
    } catch {
      /* prochain */
    }
  }
  return false;
}

app.post("/confirm-noip", async (req, res) => {
  let responseSent = false;

  try {
    const p = await getPage();

    console.log(`\n🤖 confirm-noip démarré sur : ${p.url()}`);

    await p.waitForLoadState("domcontentloaded");

    await randomDelay(1800, 3000);

    const onRenewUpsellPage = await isOnRenewUpsellPage(p);

    const onConfirmPage = !onRenewUpsellPage && (await isOnConfirmPage(p));

    let captcha1Solved = false;
    let page1Submitted = false;
    let captcha2Solved = false;
    let page2Submitted = false;

    if (onRenewUpsellPage) {
      console.log("\n━━━━━━ CAS C : Page Upsell ━━━━━━");

      page1Submitted = await clickRenewButton(p);

      console.log("\n⏳ Attente de la navigation vers la page de captcha...");

      await p
        .waitForNavigation({
          waitUntil: "domcontentloaded",
          timeout: 15000,
        })
        .catch(() => {});

      await randomDelay(1500, 2500);

      console.log("\n━━━━━━ PAGE CAPTCHA ━━━━━━");

      captcha2Solved = await solveCaptchaOnPage(p, "AFTER_RENEW");

      await randomDelay(800, 1500);

      page2Submitted = await clickSubmitButton(p, "AFTER_RENEW");
    } else if (onConfirmPage) {
      console.log("\n━━━━━━ CAS A : Page Confirm hostname ━━━━━━");

      captcha1Solved = await solveCaptchaOnPage(p, "PAGE1");

      await randomDelay(800, 1500);

      page1Submitted = await clickConfirmButton(p);

      if (!page1Submitted) {
        console.log("⚠️ Bouton confirm non trouvé – tentative Enter...");

        await p.keyboard.press("Enter");
      }

      console.log("\n⏳ Attente de la redirect...");

      const urlAvantConfirm = p.url();

      await p
        .waitForNavigation({
          waitUntil: "domcontentloaded",
          timeout: 15000,
        })
        .catch(() => {});

      await randomDelay(1500, 2500);

      const urlApresConfirm = p.url();

      if (urlApresConfirm !== urlAvantConfirm) {
        console.log(`📍 Redirect détectée → ${urlApresConfirm}`);
      } else {
        console.log(`📍 Même URL : ${urlApresConfirm}`);
      }

      console.log("\n━━━━━━ PAGE 2 : Captcha ━━━━━━");

      captcha2Solved = await solveCaptchaOnPage(p, "PAGE2");

      await randomDelay(800, 1500);

      page2Submitted = await clickSubmitButton(p, "PAGE2");
    } else {
      console.log("\n━━━━━━ CAS B : Page captcha directe ━━━━━━");

      captcha2Solved = await solveCaptchaOnPage(p, "DIRECT");

      await randomDelay(800, 1500);

      page2Submitted = await clickSubmitButton(p, "DIRECT");

      if (!page2Submitted) {
        console.log("ℹ️ Aucun bouton submit.");
      }
    }

    // ─────────────────────────────────────────
    // Vérification finale
    // ─────────────────────────────────────────

    await randomDelay(3000, 5000);

    await p.waitForLoadState("domcontentloaded").catch(() => {});

    const isUpdateSuccessfulHeader = await p
      .locator('text="Update Successful"')
      .isVisible({
        timeout: 5000,
      })
      .catch(() => false);

    const isThankYouText = await p
      .locator('text*="Thank you for confirming your hostname"')
      .isVisible({
        timeout: 2000,
      })
      .catch(() => false);

    const isTakeMeToAccountBtn = await p
      .locator(
        'a:has-text("Take Me To My Account"), button:has-text("Take Me To My Account")',
      )
      .isVisible({
        timeout: 2000,
      })
      .catch(() => false);

    const finalUrl = p.url();

    const pageText = await p.textContent("body").catch(() => "");

    const lower = pageText.toLowerCase();

    const success =
      isUpdateSuccessfulHeader ||
      isThankYouText ||
      isTakeMeToAccountBtn ||
      lower.includes("update successful") ||
      lower.includes("thank you for confirming") ||
      lower.includes("has been updated successfully");

    const mode = onRenewUpsellPage
      ? "CAS C (Upsell + Captcha)"
      : onConfirmPage
        ? "CAS A (Confirm + Captcha)"
        : "CAS B (Captcha direct)";

    console.log(`\n📊 Résultat [${mode}] :`);

    if (onRenewUpsellPage) {
      console.log(`   Page 1 – Renew Click : ${page1Submitted ? "✅" : "❌"}`);
    } else if (onConfirmPage) {
      console.log(`   Page 1 – Captcha : ${captcha1Solved ? "✅" : "⚠️"}`);

      console.log(`   Page 1 – Confirm : ${page1Submitted ? "✅" : "❌"}`);
    }

    console.log(`   Page Captcha – Résolu: ${captcha2Solved ? "✅" : "ℹ️"}`);

    console.log(`   Page Captcha – Submit: ${page2Submitted ? "✅" : "ℹ️"}`);

    console.log(
      `   Vérification Succès: ${
        success ? "✅ UPDATE SUCCESSFUL" : "⚠️ Non confirmé"
      }`,
    );

    console.log(`   URL finale: ${finalUrl}`);

    const result = {
      success,
      mode,

      page1: onRenewUpsellPage
        ? {
            renewClicked: page1Submitted,
          }
        : onConfirmPage
          ? {
              captchaSolved: captcha1Solved,
              confirmClicked: page1Submitted,
            }
          : null,

      page2: {
        captchaSolved: captcha2Solved,
        submitClicked: page2Submitted,
      },

      confirmedOnPage: success,

      detectedElements: {
        updateSuccessfulHeader: isUpdateSuccessfulHeader,
        thankYouText: isThankYouText,
        takeMeToAccountBtn: isTakeMeToAccountBtn,
      },

      finalUrl,
    };

    responseSent = true;

    res.json(result);
  } catch (error) {
    console.error("❌ Erreur /confirm-noip :", error);

    browser = null;
    page = null;

    if (!responseSent) {
      responseSent = true;

      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  } finally {
    // ─────────────────────────────────────────
    // ALWAYS remove browser containers
    // ─────────────────────────────────────────

    console.log("\n🧹 Cleaning browser containers...");

    await removeBrowserContainers();

    browser = null;
    page = null;

    console.log("🧹 Browser cleanup finished");
  }
});

// ─────────────────────────────────────────────
// Démarrage du serveur
// ─────────────────────────────────────────────

app.listen(PORT, "0.0.0.0", () => {
  console.log("=================================");
  console.log("Playwright API");
  console.log(`Listening on port ${PORT}`);
  console.log(`Chromium CDP: ${CDP_URL}`);
  console.log(`Start script: ${START_BROWSER_SCRIPT}`);
  console.log(`Remove script: ${REMOVE_BROWSER_SCRIPT}`);
  console.log("Endpoints:");
  console.log("  POST /open         – ouvre une URL");
  console.log("  GET  /status       – état de la connexion");
  console.log("  POST /confirm-noip – séquence complète 2 pages");
  console.log("=================================");
});