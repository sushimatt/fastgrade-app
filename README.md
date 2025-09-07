# 📘 FastGrade App

**FastGrade App** is a cross-platform desktop application built with **React + Vite + Electron** that uses **ChatGPT** to automatically grade student submissions against an answer key.

It supports multiple file formats (TXT, DOCX, PDF, ZIP), allows pasting answers directly, and provides per-question evaluation with closeness scores, pass/fail indicators, and exportable results.

---

## ✨ Features

* 📂 Upload **Answer Key** (TXT, DOCX, PDF).
* 📂 Upload or paste **Student Submissions** (TXT, DOCX, PDF, ZIP).
* 🤖 Uses **OpenAI’s GPT model** for grading.
* 🔍 Provides detailed per-question results:

  * Student’s answer
  * Correct answer
  * Verdict (Correct, Partial, Incorrect)
  * Closeness (%)
* 📊 Dynamic **Scores Overview** panel:

  * Final score
  * Pass/Fail (threshold configurable, default 70%)
  * Letter grade (A/B/C/F)
* ✅ Click student name in overview to jump to full results.
* 📤 Export all results to CSV.
* ⚙️ Configurable grading **prompt** (saved persistently).
* 🖥️ Packaged for **Windows (.exe portable)**, **macOS (.dmg)**, and **Linux (.AppImage)**.

---

## ⚙️ Configuration

### 1. API Key

You need an [OpenAI API key](https://platform.openai.com/).

* Enter it once in the app → it is saved securely in local storage until replaced.

### 2. Grading Prompt

* Click **Configure Prompt** in the toolbar to edit the grading instructions.
* Saved persistently in local storage.

### 3. Pass Threshold

* Default is **70%**.
* Editable in toolbar input.
* Used for pass/fail and letter grade assignment.

---

## 🚀 Usage

1. Launch the app.
2. Enter your **OpenAI API key** in the toolbar.
3. Upload an **Answer Key** (TXT, DOCX, or PDF).
4. Upload one or more **Student Submissions** (TXT, DOCX, PDF, or ZIP with multiple files).
5. Click **Grade Current** to grade one student, or **Grade All** to process all.
6. View per-question results in the **Evaluation** column.
7. Check overall results in the **Scores Overview** column.
8. Export results to CSV using the **Export CSV** button.

---

## 🛠️ Development

### Install

```bash
git clone git@github.com:sushimatt/fastgrade-app.git
cd fastgrade-app
npm install
```

### Run in development

```bash
npm run dev       # Start Vite React dev server
npm run electron-dev   # Run with Electron window
```

### Build for production

```bash
npm run dist
```

Artifacts will be in the `release/` folder:

* **Windows**: `.exe` (portable)
* **macOS**: `.dmg`
* **Linux**: `.AppImage`

---

## 📦 Distribution

* **Windows Portable `.exe`** → run without installation.
* **macOS `.dmg`** → drag-and-drop installation.
* **Linux `.AppImage`** → make executable (`chmod +x`) and run directly.

---

## 🙌 Credits

* Built with [React](https://react.dev/), [Vite](https://vitejs.dev/), [Electron](https://www.electronjs.org/).
* Uses [JSZip](https://stuk.github.io/jszip/), [Mammoth.js](https://github.com/mwilliamson/mammoth.js) for DOCX parsing, [pdf.js](https://mozilla.github.io/pdf.js/) for PDF parsing.
* Powered by [OpenAI GPT API](https://platform.openai.com/).
* Icon designed with a **flat modern style** (paper + checkmarks + chat bubble).

---

## 📜 License

MIT License © 2025 — \Mateo Portela (sushimatt)
