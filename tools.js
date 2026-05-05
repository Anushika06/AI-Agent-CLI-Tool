/**
 * @fileoverview Tool implementations for the Website Cloner AI Agent.
 * Provides scraping, file I/O, and browser-open utilities called by the agent loop.
 */

import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs/promises";
import { exec } from "child_process";
import path from "path";

// ─── scrapeWebsite ────────────────────────────────────────────────────────────

/**
 * Fetches a webpage and returns a structured, summarized string describing its
 * visual content, layout, and color palette — safe to pass into an LLM context.
 *
 * @param {string} url - The full URL of the website to scrape.
 * @returns {Promise<string>} A human-readable summary of the page structure.
 */
export async function scrapeWebsite(url) {
  try {
    console.log(`\n  🌐 Fetching: ${url}`);

    const { data: html } = await axios.get(url, {
      timeout: 15000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        Connection: "keep-alive",
      },
    });

    const $ = cheerio.load(html);

    // ── Page title ────────────────────────────────────────────────────────────
    const pageTitle = $("title").first().text().trim() || "No title found";

    // ── Meta description ──────────────────────────────────────────────────────
    const metaDesc =
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "";

    // ── Navigation links ──────────────────────────────────────────────────────
    const navLinks = [];
    $("nav a, header a").each((_, el) => {
      const text = $(el).text().trim();
      if (text && text.length < 60 && navLinks.length < 15) {
        navLinks.push(text);
      }
    });

    // ── Hero / main headings ──────────────────────────────────────────────────
    const h1Texts = [];
    $("h1").each((_, el) => {
      const t = $(el).text().trim();
      if (t) h1Texts.push(t);
    });

    const h2Texts = [];
    $("h2").each((_, el) => {
      const t = $(el).text().trim();
      if (t && h2Texts.length < 6) h2Texts.push(t);
    });

    // ── CTA buttons ───────────────────────────────────────────────────────────
    const ctaTexts = [];
    $("button, a.btn, a[class*='btn'], a[class*='cta'], a[class*='button']").each(
      (_, el) => {
        const t = $(el).text().trim();
        if (t && t.length < 50 && ctaTexts.length < 8) ctaTexts.push(t);
      }
    );

    // ── Color palette (from inline styles + <style> tags) ────────────────────
    const colorSet = new Set();
    const colorRegex = /#([0-9a-fA-F]{3,6})\b|rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)/g;

    $("[style]").each((_, el) => {
      const style = $(el).attr("style") || "";
      const matches = style.match(colorRegex) || [];
      matches.forEach((c) => colorSet.add(c));
    });

    $("style").each((_, el) => {
      const css = $(el).html() || "";
      const matches = css.match(colorRegex) || [];
      matches.slice(0, 20).forEach((c) => colorSet.add(c));
    });

    // ── Footer links ──────────────────────────────────────────────────────────
    const footerLinks = [];
    $("footer a").each((_, el) => {
      const t = $(el).text().trim();
      if (t && t.length < 60 && footerLinks.length < 20) footerLinks.push(t);
    });

    // ── Paragraph / subtext ───────────────────────────────────────────────────
    const paragraphs = [];
    $("p").each((_, el) => {
      const t = $(el).text().trim();
      if (t.length > 40 && paragraphs.length < 5) paragraphs.push(t);
    });

    // ── Logo / brand name ─────────────────────────────────────────────────────
    const logoText =
      $('[class*="logo"]').first().text().trim() ||
      $('[class*="brand"]').first().text().trim() ||
      $('header [class*="name"]').first().text().trim() ||
      "";

    // ── Build summary string ──────────────────────────────────────────────────
    const summary = `
=== SCRAPED WEBSITE SUMMARY ===
URL: ${url}
Page Title: ${pageTitle}
Meta Description: ${metaDesc.slice(0, 200)}
Brand / Logo Text: ${logoText || "(not detected)"}

--- NAVIGATION LINKS ---
${navLinks.length ? navLinks.join(" | ") : "(none detected)"}

--- HERO SECTION ---
H1 Headlines:
${h1Texts.length ? h1Texts.map((t) => `  • ${t}`).join("\n") : "  (none detected)"}

H2 Sub-headlines:
${h2Texts.length ? h2Texts.map((t) => `  • ${t}`).join("\n") : "  (none detected)"}

CTA Buttons:
${ctaTexts.length ? ctaTexts.map((t) => `  • ${t}`).join("\n") : "  (none detected)"}

--- SUPPORTING TEXT ---
${paragraphs.length ? paragraphs.map((t) => `  "${t.slice(0, 150)}"`).join("\n") : "  (none detected)"}

--- COLOR PALETTE (from inline styles & CSS) ---
${colorSet.size ? [...colorSet].slice(0, 15).join(", ") : "(none extracted — use your knowledge of the brand)"}

--- FOOTER LINKS ---
${footerLinks.length ? footerLinks.join(" | ") : "(none detected)"}
=== END OF SUMMARY ===
`.trim();

    return summary;
  } catch (err) {
    console.error(`  ⚠️  Scrape failed: ${err.message}`);
    return (
      `Could not scrape the site (reason: ${err.message}). ` +
      `Generating clone from knowledge instead. ` +
      `URL attempted: ${url}`
    );
  }
}

// ─── writeFile ────────────────────────────────────────────────────────────────

/**
 * Writes content to a file in the current working directory.
 *
 * @param {string} filename - Relative filename (e.g., "scaler_clone.html").
 * @param {string} content  - The string content to write.
 * @returns {Promise<string>} A confirmation message with the absolute file path.
 */
export async function writeFile(filename, content) {
  try {
    const filepath = path.resolve(process.cwd(), filename);
    await fs.writeFile(filepath, content, "utf-8");
    const size = Buffer.byteLength(content, "utf-8");
    return `✅ File written successfully.\nPath: ${filepath}\nSize: ${(size / 1024).toFixed(1)} KB`;
  } catch (err) {
    return `❌ Failed to write file "${filename}": ${err.message}`;
  }
}

// ─── readFile ─────────────────────────────────────────────────────────────────

/**
 * Reads a file from the current working directory and returns its content.
 *
 * @param {string} filename - Relative filename to read.
 * @returns {Promise<string>} The file content, or an error message.
 */
export async function readFile(filename) {
  try {
    const filepath = path.resolve(process.cwd(), filename);
    const content = await fs.readFile(filepath, "utf-8");
    const preview = content.slice(0, 500);
    const totalLines = content.split("\n").length;
    return (
      `✅ File read successfully (${totalLines} lines, ${content.length} chars).\n` +
      `--- FIRST 500 CHARS ---\n${preview}\n--- END PREVIEW ---`
    );
  } catch (err) {
    return `❌ Failed to read file "${filename}": ${err.message}`;
  }
}

// ─── openInBrowser ───────────────────────────────────────────────────────────

/**
 * Opens an HTML file in the user's default web browser.
 * Detects the OS via process.platform and uses the appropriate shell command.
 *
 * @param {string} filename - Relative filename of the HTML file to open.
 * @returns {Promise<string>} A confirmation message or an error string.
 */
export async function openInBrowser(filename) {
  return new Promise((resolve) => {
    const filepath = path.resolve(process.cwd(), filename);
    let cmd;

    switch (process.platform) {
      case "darwin":
        cmd = `open "${filepath}"`;
        break;
      case "win32":
        cmd = `start "" "${filepath}"`;
        break;
      default:
        // Linux and other Unix-like systems
        cmd = `xdg-open "${filepath}"`;
    }

    exec(cmd, (err) => {
      if (err) {
        resolve(
          `⚠️  Could not open browser automatically: ${err.message}\n` +
            `Please open this file manually: ${filepath}`
        );
      } else {
        resolve(
          `✅ Opened "${filename}" in your default browser.\nFull path: ${filepath}`
        );
      }
    });
  });
}

// ─── Tool map ─────────────────────────────────────────────────────────────────

/**
 * Maps tool names (as used by the agent) to their implementation functions.
 * The agent loop uses this map to dispatch tool calls dynamically.
 *
 * @type {Object.<string, Function>}
 */
export const toolMap = {
  scrapeWebsite: ({ url }) => scrapeWebsite(url),
  writeFile: ({ filename, content }) => writeFile(filename, content),
  readFile: ({ filename }) => readFile(filename),
  openInBrowser: ({ filename }) => openInBrowser(filename),
};
