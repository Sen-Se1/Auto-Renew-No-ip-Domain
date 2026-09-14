const express = require("express");
const { chromium } = require("playwright");

const app = express();
app.use(express.json());

let browser = null;
let page = null;

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
    console.log("Connecting to Chromium...");
    browser = await chromium.connectOverCDP("http://192.168.1.100:9223");
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
    console.log(`🎙️  [${label}] Recherche de l'iframe de challenge reCAPTCHA...`);
    
    // Attendre l'iframe bframe (challenge)
    const bframeLocator = page.frameLocator('iframe[src*="recaptcha/api2/bframe"], iframe[src*="recaptcha/enterprise/bframe"]').first();
    
    // Clic sur l'icône Audio (#recaptcha-audio-button)
    const audioBtn = bframeLocator.locator("#recaptcha-audio-button");
    const canClickAudio = await audioBtn.isVisible({ timeout: 5000 }).catch(() => false);

    if (!canClickAudio) {
      console.log(`⚠️  [${label}] Bouton Audio non trouvé dans l'iframe de challenge.`);
      return false;
    }

    await humanClick(page, audioBtn);
    console.log(`🖱️  [${label}] Bouton Challenge Audio cliqué !`);
    await randomDelay(2000, 3000);

    // Vérifier si Google bloque l'audio ("Your computer or network may be sending automated queries")
    const isBlocked = await bframeLocator.locator(".rc-doodle-default, .rc-audiochallenge-error-message").isVisible().catch(() => false);
    if (isBlocked) {
      console.log(`⚠️  [${label}] Google a temporairement bloqué les requêtes audio sur cette IP.`);
      return false;
    }

    // Récupérer le lien de téléchargement audio MP3 (.rc-audiochallenge-tdownload-link) ou l'élément audio (#audio-source)
    const downloadLink = bframeLocator.locator(".rc-audiochallenge-tdownload-link, audio#audio-source").first();
    await downloadLink.waitFor({ state: "attached", timeout: 10000 });

    const audioUrl = await downloadLink.evaluate(el => el.href || el.src);
    if (!audioUrl) {
      console.log(`❌ [${label}] Impossible de récupérer l'URL du fichier audio.`);
      return false;
    }

    console.log(`📥 [${label}] Téléchargement du fichier audio...`);
    const audioBuffer = await fetch(audioUrl).then(r => r.arrayBuffer());
    const base64Audio = Buffer.from(audioBuffer).toString("base64");

    console.log(`🧠 [${label}] Reconnaissance vocale avec Google Gemini IA...`);
    let text = "";

    // ── Source 1 : Google Gemini API (Ultra rapide & gratuit) ─────────────
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
    if (GEMINI_API_KEY) {
      // Liste des modèles Gemini par ordre de priorité
      const models = ["gemini-3.6-flash","gemini-2.5-flash"];
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
                          data: base64Audio
                        }
                      },
                      {
                        text: "Listen to this reCAPTCHA audio challenge. Transcribe ONLY the numbers or words spoken. Output nothing else, no punctuation, no extra words."
                      }
                    ]
                  }
                ]
              })
            }
          ).then(r => r.json());

          if (geminiRes?.candidates?.[0]?.content?.parts?.[0]?.text) {
            text = geminiRes.candidates[0].content.parts[0].text.trim();
            console.log(`✨ [${label}] Transcrit par ${model} : "${text}"`);
            break;
          } else if (geminiRes?.error) {
            console.log(`  └ ${model} indisponible : ${geminiRes.error.message.split('\n')[0]}`);
          }
        } catch (e) {
          console.log(`  └ Erreur ${model} : ${e.message}`);
        }
      }
    } else {
      console.log(`ℹ️  [${label}] GEMINI_API_KEY non fournie. Passage aux modèles de secours...`);
    }

    // ── Source 2 : HuggingFace Whisper (Fallback 1) ──────────────────────
    if (!text) {
      try {
        const hfRes = await fetch("https://api-inference.huggingface.co/models/openai/whisper-large-v3-turbo", {
          method: "POST",
          headers: { "Content-Type": "audio/mpeg" },
          body: Buffer.from(audioBuffer)
        }).then(r => r.json());

        if (hfRes && hfRes.text) {
          text = hfRes.text.trim();
          console.log(`🎯 [${label}] Transcrit via Whisper : "${text}"`);
        }
      } catch (e) {}
    }

    // ── Source 3 : Wit.ai API Speech ─────────────────────────────
    if (!text) {
      try {
        const witRes = await fetch("https://api.wit.ai/speech", {
          method: "POST",
          headers: {
            "Authorization": "Bearer 377A6N7S5WT3RSHX6SHP5BOHPWXZJ24K",
            "Content-Type": "audio/mpeg"
          },
          body: Buffer.from(audioBuffer)
        }).then(r => r.json());

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
      console.log(`❌ [${label}] Échec de la transcription audio sur toutes les sources.`);
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
      const ta = document.querySelector('textarea[name="g-recaptcha-response"], #g-recaptcha-response');
      return ta && ta.value && ta.value.length > 10;
    });

    if (isSolved) {
      console.log(`🎯 [${label}] Captcha audio validé avec succès ✅`);
      return true;
    }

  } catch (e) {
    console.log(`⚠️  [${label}] Erreur pendant la résolution audio : ${e.message}`);
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
  const hasHcaptcha = await p.locator('iframe[src*="hcaptcha"]').count().then(n => n > 0).catch(() => false);
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
        .isVisible().catch(() => false);

      if (challengeVisible) {
        console.log(`⚠️  [${label}] Challenge hCAPTCHA – attente max 45s...`);
        await p
          .waitForSelector('iframe[src*="hcaptcha"][src*="challenge"]', { state: "hidden", timeout: 45000 })
          .catch(() => console.log(`⏱️  [${label}] Timeout challenge, on continue...`));
        await randomDelay(1000, 2000);
      }

      console.log(`🎯 [${label}] hCAPTCHA traité ✅`);
      return true;
    } catch (e) {
      console.log(`⚠️  [${label}] Erreur hCAPTCHA : ${e.message}`);
    }
  }

  // ── reCAPTCHA v2 (priorité 2) ────────────────────────────────────────
  const rSelector = 'iframe[src*="recaptcha/api2/anchor"], iframe[src*="recaptcha/enterprise/anchor"]';
  const hasRecaptcha = await p.locator(rSelector).count().then(n => n > 0).catch(() => false);

  if (!hasRecaptcha) {
    const hasAny = await p.locator('iframe[src*="recaptcha"]').count().then(n => n > 0).catch(() => false);
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
    let solved = await p.waitForFunction(
      () => {
        const ta = document.querySelector('textarea[name="g-recaptcha-response"], #g-recaptcha-response');
        return ta && ta.value && ta.value.length > 10;
      },
      { timeout: 8000 }
    ).catch(() => null);

    if (solved) {
      console.log(`🎯 [${label}] reCAPTCHA résolu automatiquement (sans challenge) ✅`);
      return true;
    }

    // ── Si un challenge image apparaît, bascule sur la méthode AUDIO GRATUITE ────
    console.log(`⚠️  [${label}] Challenge détecté. Bascule sur la méthode Audio Speech-to-Text gratuite...`);
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
    if (!url) return res.status(400).json({ success: false, error: "url is required" });

    console.log(`Opening: ${url}`);
    const p = await getPage();
    await p.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    console.log(`Opened: ${p.url()}`);

    res.json({ success: true, requestedUrl: url, currentUrl: p.url(), title: await p.title() });
  } catch (error) {
    console.error(error);
    browser = null;
    page = null;
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─────────────────────────────────────────────
// GET /status  – état de la connexion
// ─────────────────────────────────────────────

app.get("/status", async (req, res) => {
  try {
    const p = await getPage();
    res.json({ success: true, connected: true, url: p.url(), title: await p.title() });
  } catch (error) {
    res.status(500).json({ success: false, connected: false, error: error.message });
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
    'input[value*="Confirm your hostname"]',
    'a:has-text("Confirm your hostname")',
  ];
  for (const sel of selectors) {
    try {
      const visible = await p.locator(sel).first().isVisible({ timeout: 3000 }).catch(() => false);
      if (visible) return true;
    } catch { /* continuer */ }
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
        await humanMouseMove(p, btnBox.x + btnBox.width / 2, btnBox.y + btnBox.height / 2);
        await randomDelay(200, 400);
      }
      await humanClick(p, btn);
      console.log('🖱️  "Confirm your hostname now" cliqué !');
      return true;
    } catch { /* prochain */ }
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
    } catch { /* prochain */ }
  }
  return false;
}

app.post("/confirm-noip", async (req, res) => {
  try {
    const p = await getPage();
    console.log(`\n🤖 confirm-noip démarré sur : ${p.url()}`);

    await p.waitForLoadState("domcontentloaded");
    await randomDelay(1800, 3000); // pause lecture humaine

    // ══════════════════════════════════════════════════════
    // DÉTECTION : sur quelle page sommes-nous ?
    // ══════════════════════════════════════════════════════

    const onConfirmPage = await isOnConfirmPage(p);

    let captcha1Solved = false;
    let page1Submitted = false;
    let captcha2Solved = false;
    let page2Submitted = false;

    if (onConfirmPage) {
      // ──────────────────────────────────────────────────
      // CAS A : Page "Confirm your hostname now"
      //   → hCAPTCHA + bouton confirm → redirect → captcha page
      // ──────────────────────────────────────────────────
      console.log("\n━━━━━━ CAS A : Page Confirm hostname ━━━━━━");

      // Étape 1 : Résoudre le captcha de la page 1
      captcha1Solved = await solveCaptchaOnPage(p, "PAGE1");

      // Étape 2 : Cliquer "Confirm your hostname now"
      await randomDelay(800, 1500);
      page1Submitted = await clickConfirmButton(p);
      if (!page1Submitted) {
        console.log("⚠️  Bouton confirm non trouvé – tentative Enter...");
        await p.keyboard.press("Enter");
      }

      // Attendre la redirect (max 15s) – comparaison d'URL avant/après
      console.log("\n⏳ Attente de la redirect vers la page captcha...");
      const urlAvantConfirm = p.url();
      await p
        .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 })
        .catch(() => {/* pas de navigation = page reste la même, c'est ok */});

      await randomDelay(1500, 2500);
      const urlApresConfirm = p.url();

      if (urlApresConfirm !== urlAvantConfirm) {
        console.log(`📍 Redirect détectée → ${urlApresConfirm}`);
      } else {
        console.log(`📍 Même URL (page rechargée ou captcha en attente) : ${urlApresConfirm}`);
      }

      // Étape 3 : Résoudre le captcha de la page 2 (ou de la même page rechargée)
      console.log("\n━━━━━━ PAGE 2 : Captcha après confirm ━━━━━━");
      captcha2Solved = await solveCaptchaOnPage(p, "PAGE2");

      // Étape 4 : Soumettre si bouton présent sur page 2
      await randomDelay(800, 1500);
      page2Submitted = await clickSubmitButton(p, "PAGE2");

    } else {
      // ──────────────────────────────────────────────────
      // CAS B : Page captcha directe (pas de bouton confirm)
      //   → résoudre le captcha et soumettre directement
      // ──────────────────────────────────────────────────
      console.log("\n━━━━━━ CAS B : Page captcha directe ━━━━━━");

      captcha2Solved = await solveCaptchaOnPage(p, "DIRECT");

      await randomDelay(800, 1500);
      page2Submitted = await clickSubmitButton(p, "DIRECT");

      if (!page2Submitted) {
        console.log("ℹ️  Aucun bouton submit – le captcha seul suffit peut-être.");
      }
    }

    // ══════════════════════════════════════════════════════
    // Vérification finale
    // ══════════════════════════════════════════════════════

    await randomDelay(3000, 5000);
    await p.waitForLoadState("domcontentloaded").catch(() => {});

    const finalUrl = p.url();
    const pageText = await p.textContent("body").catch(() => "");
    const lower = pageText.toLowerCase();
    const success =
      lower.includes("success") ||
      lower.includes("confirmed") ||
      lower.includes("updated") ||
      lower.includes("active") ||
      finalUrl.includes("success") ||
      finalUrl.includes("confirmed");

    const mode = onConfirmPage ? "CAS A (2 pages)" : "CAS B (captcha direct)";
    console.log(`\n📊 Résultat [${mode}] :`);
    if (onConfirmPage) {
      console.log(`   Page 1 – Captcha  : ${captcha1Solved ? "✅" : "⚠️"}`);
      console.log(`   Page 1 – Confirm  : ${page1Submitted ? "✅" : "❌"}`);
    }
    console.log(`   Page 2 – Captcha  : ${captcha2Solved ? "✅" : "ℹ️  Aucun"}`);
    console.log(`   Page 2 – Submit   : ${page2Submitted ? "✅" : "ℹ️  Aucun"}`);
    console.log(`   Succès final      : ${success ? "✅" : "⚠️  Incertain"}`);
    console.log(`   URL finale        : ${finalUrl}`);

    res.json({
      success: true,
      mode,
      page1: onConfirmPage ? { captchaSolved: captcha1Solved, confirmClicked: page1Submitted } : null,
      page2: { captchaSolved: captcha2Solved, submitClicked: page2Submitted },
      confirmedOnPage: success,
      finalUrl,
    });
  } catch (error) {
    console.error("❌ Erreur /confirm-noip :", error);
    browser = null;
    page = null;
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─────────────────────────────────────────────
// Démarrage du serveur
// ─────────────────────────────────────────────

app.listen(3002, "0.0.0.0", () => {
  console.log("=================================");
  console.log("Playwright API");
  console.log("Listening on port 3002");
  console.log("Chromium CDP: 192.168.1.100:9223");
  console.log("Endpoints:");
  console.log("  POST /open         – ouvre une URL");
  console.log("  GET  /status       – état de la connexion");
  console.log("  POST /confirm-noip – séquence complète 2 pages");
  console.log("=================================");
});