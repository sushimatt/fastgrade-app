import React, { useState, useEffect } from "react";
import JSZip from "jszip";
import mammoth from "mammoth";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import Tesseract from "tesseract.js";
import "./App.css";

GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.worker.min.mjs";

// -------------------- Helpers --------------------
const calculateTotals = (result) => {
  if (!result || !result.questions) return { total: 0, worth: 0, pct: 0 };

  const total = result.questions.reduce(
    (sum, q) => sum + (parseFloat(q.questionscore) || 0),
    0
  );

  const worth =
    result.testworth ||
    result.questions.reduce(
      (sum, q) => sum + (parseFloat(q.maxscore) || 1),
      0
    );

  const pct = worth > 0 ? (total / worth) * 100 : 0;

  if (result.total_score && Math.abs(result.total_score - total) > 0.01) {
    console.warn(
      `⚠️ Mismatch: GPT total_score=${result.total_score}, recalculated=${total}`
    );
  }

  return { total, worth, pct };
};

const readTxtFile = (file) =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (ev) => resolve(ev.target.result);
    reader.readAsText(file);
  });

const readDocxFile = (file) =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const result = await mammoth.extractRawText({
          arrayBuffer: ev.target.result,
        });
        resolve(result.value);
      } catch (err) {
        resolve("Error reading docx: " + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  });

const readPdfFile = (file) =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const typedArray = new Uint8Array(ev.target.result);
      const pdf = await getDocument(typedArray).promise;
      let text = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((s) => s.str).join(" ") + "\n";
      }
      resolve(text);
    };
    reader.readAsArrayBuffer(file);
  });

// OCR for images
const readImageFile = (file) =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const { data: { text } } = await Tesseract.recognize(ev.target.result, "eng");
        resolve(text);
      } catch (err) {
        resolve("Error reading image: " + err.message);
      }
    };
    reader.readAsDataURL(file);
  });

// Split text into multiple students (simple: by "Student:" or page delimiter)
const splitStudentsFromText = (text) => {
  // Try to split by "Student:" or "Name:" or page breaks
  const parts = text
    .split(/\n\s*(Student:|Name:|Page \d+|-----+)\s*\n/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  // If only one part, return as single student
  if (parts.length <= 1) return [text];
  // Otherwise, group by every other part (since split keeps delimiters)
  let students = [];
  for (let i = 0; i < parts.length; i += 2) {
    students.push(parts[i] + (parts[i + 1] ? "\n" + parts[i + 1] : ""));
  }
  return students;
};

// -------------------- App --------------------
export default function App() {
  const [apiKey, setApiKey] = useState("");
  const [answerKey, setAnswerKey] = useState("");
  const [students, setStudents] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [passThreshold, setPassThreshold] = useState(70); // default 70%

  const [gradingPrompt, setGradingPrompt] = useState(
  "You are a grading assistant. Compare student answers to the key and provide structured results. Extract the student's name if present. For each question, return closeness %, verdict, and per-question score. Include total_score and testworth (sum of max points). Grade each questions comparing conceptually the provided key answer to the question, and admit different verbiage and phrasing, do not discount points for change of language style, grammatical errors or spelling inconsistencies. Discount points for non completeness."
  );
  const [showPromptConfig, setShowPromptConfig] = useState(false);
  const [modalHeight, setModalHeight] = useState(400);
  const [dragging, setDragging] = useState(false);
  const [dragStartY, setDragStartY] = useState(0);
  const [startHeight, setStartHeight] = useState(400);

  // load saved key and prompt
  useEffect(() => {
    const saved = localStorage.getItem("openai_api_key");
    if (saved) setApiKey(saved);

    const savedPrompt = localStorage.getItem("grading_prompt");
    if (savedPrompt) setGradingPrompt(savedPrompt);
  }, []);

  const handleApiKeyChange = (e) => {
    const newKey = e.target.value;
    setApiKey(newKey);
    if (newKey.trim()) localStorage.setItem("openai_api_key", newKey.trim());
  };

  const updateStudent = (index, updates) => {
    setStudents((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], ...updates };
      return updated;
    });
  };

  // -------------------- Upload handlers --------------------
  const handleAnswerKeyUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    let content = "";
    if (file.name.endsWith(".txt")) content = await readTxtFile(file);
    else if (file.name.endsWith(".docx")) content = await readDocxFile(file);
    else if (file.name.endsWith(".pdf")) content = await readPdfFile(file);
    else content = "Unsupported file type";
    setAnswerKey(content);
  };

  const handleStudentUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const addStudent = async (f) => {
      let content = "";
      if (f.name.match(/\.(txt)$/i)) content = await readTxtFile(f);
      else if (f.name.match(/\.(docx)$/i)) content = await readDocxFile(f);
      else if (f.name.match(/\.(pdf)$/i)) content = await readPdfFile(f);
      else if (f.name.match(/\.(jpe?g|png|tiff?)$/i)) content = await readImageFile(f);
      else content = "Unsupported file type";
      return {
        name: f.name,
        content,
        result: null,
        status: "idle",
        gradedAt: null,
        elapsed: 0,
      };
    };

    // Handle ZIP as before
    if (file.name.endsWith(".zip")) {
      const zip = await JSZip.loadAsync(file);
      const files = [];
      for (const filename of Object.keys(zip.files)) {
        if (!zip.files[filename].dir) {
          const blob = await zip.files[filename].async("blob");
          const extracted = new File([blob], filename);
          files.push(await addStudent(extracted));
        }
      }
      setStudents(files);
      setCurrentIndex(0);
      return;
    }

    // For PDF and image: allow splitting into multiple students
    if (file.name.match(/\.(pdf|jpe?g|png|tiff?)$/i)) {
      let content = "";
      if (file.name.match(/pdf$/i)) content = await readPdfFile(file);
      else content = await readImageFile(file);

      const studentTexts = splitStudentsFromText(content);
      const studentObjs = studentTexts.map((text, idx) => ({
        name: `${file.name}-Student${idx + 1}`,
        content: text,
        result: null,
        status: "idle",
        gradedAt: null,
        elapsed: 0,
      }));
      setStudents(studentObjs);
      setCurrentIndex(0);
      return;
    }

    // Default: single student
    setStudents([await addStudent(file)]);
    setCurrentIndex(0);
  };

  const handlePasteStudent = () => {
    setStudents((prev) => [
      ...prev,
      {
        name: `Pasted-${prev.length + 1}`,
        content: "",
        result: null,
        status: "idle",
        gradedAt: null,
        elapsed: 0,
      },
    ]);
    setCurrentIndex((prev) => prev + 1);
  };

  // -------------------- Grading --------------------
  const gradeOne = async (student, index) => {
    console.log(`📤 Grading student: ${student.name}`);
    updateStudent(index, { status: "sent", elapsed: 0 });

    let seconds = 0;
    const timer = setInterval(() => {
      seconds++;
      updateStudent(index, {
        status: `processing (${seconds}s)`,
        elapsed: seconds,
      });
    }, 1000);

    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: gradingPrompt },
            {
              role: "user",
              content: `Key:\n${answerKey}\n\nStudent submission:\n${student.content}\n\nReturn JSON with structure:
{
  "student_name": string,
  "total_score": number,
  "testworth": number,
  "questions": [
    {"id": "q1", "question": string, "student_answer": string, "correct_answer": string, "closeness": number, "verdict": "Correct|Partial|Incorrect", "questionscore": number}
  ],
  "feedback": string
}
Only return valid JSON.`,
            },
          ],
          temperature: 0,
        }),
      });

      updateStudent(index, { status: "received" });
      const data = await response.json();
      let text = data?.choices?.[0]?.message?.content ?? "";
      console.log("📥 Raw GPT response:", text);

      let cleaned = text.trim();
      if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, "");
        cleaned = cleaned.replace(/```$/, "");
      }

      let parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch (err) {
        console.error("❌ Parse error:", err, "Raw:", text);
        parsed = { error: "Could not parse GPT response", raw: text };
      }

      updateStudent(index, {
        result: parsed,
        gradedAt: new Date().toISOString(),
        status: "displayed",
      });
      clearInterval(timer);
    } catch (err) {
      console.error("❌ Error during grading:", err);
      updateStudent(index, { status: "error" });
      clearInterval(timer);
    }
  };

  const gradeCurrent = () => {
    if (!apiKey || !answerKey || students.length === 0) return;
    gradeOne(students[currentIndex], currentIndex);
  };

  const gradeAll = async () => {
    if (!apiKey || !answerKey || students.length === 0) return;
    for (let i = 0; i < students.length; i++) {
      if (!students[i].result) {
        await gradeOne(students[i], i);
      }
    }
  };

  const exportCSV = () => {
  if (students.length === 0) return;

  const qIds = new Set();
  students.forEach((s) => s?.result?.questions?.forEach((q) => qIds.add(q.id)));
  const questionIds = Array.from(qIds);

  const headers = [
    "Name",
    "Total Score",
    ...questionIds.flatMap((id) => [
      `${id}_Question`,
      `${id}_StudentAnswer`,
      `${id}_CorrectAnswer`,
      `${id}_Verdict`,
      `${id}_Closeness`,
      `${id}_QuestionScore`,
    ]),
    "Feedback",
    "Graded At",
  ];

  const rows = students.map((s) => {
    const { total } = calculateTotals(s.result || {});
    const row = [s?.result?.student_name || s.name, total];
    questionIds.forEach((id) => {
      const q = s?.result?.questions?.find((qq) => qq.id === id);
      row.push(
        q?.question ?? "",
        q?.student_answer ?? "",
        q?.correct_answer ?? "",
        q?.verdict ?? "",
        q?.closeness ?? "",
        q?.questionscore ?? ""
      );
    });
    row.push(s?.result?.feedback ?? "", s?.gradedAt ?? "");
    return row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",");
  });

  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.setAttribute("download", "grading_results.csv");
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};


  // -------------------- Helpers --------------------
  const getLetterGrade = (pct) => {
    if (pct >= 90) return "A";
    if (pct >= 80) return "B";
    if (pct >= 70) return "C";
    return "F";
  };

  // -------------------- UI --------------------
  const currentStudent = students[currentIndex];

  return (
    <div className="h-screen flex flex-col">
      {/* API Key + Threshold */}
      <div className="toolbar">
        <button
          onClick={() => setShowPromptConfig(true)}
          className="btn-secondary"
        >
          Configure Prompt
        </button>
        <input
          type="password"
          placeholder="Enter OpenAI API Key"
          value={apiKey}
          onChange={handleApiKeyChange}
          className="input"
        />
        <input
          type="number"
          min="0"
          max="100"
          value={passThreshold}
          onChange={(e) => setPassThreshold(Number(e.target.value))}
          className="input"
          style={{ width: "120px" }}
          title="Pass/Fail Threshold (%)"
        />
        <span>Pass threshold (%)</span>
      </div>
      {/* Prompt Configuration Modal */}
      {showPromptConfig && (
        <div className="modal-overlay" onClick={() => setShowPromptConfig(false)}>
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{
              height: modalHeight,
              minHeight: 200,
              maxHeight: 700,
              overflow: "auto",
              position: "relative",
              // width: "500px", // optionally set a width
            }}
          >
            <h2 className="panel-title">Edit Grading Prompt</h2>
            <textarea
              className="textarea"
              value={gradingPrompt}
              onChange={(e) => setGradingPrompt(e.target.value)}
              style={{
                height: modalHeight - 120,
                overflowY: "auto",
                resize: "none",
                width: "100%",
                boxSizing: "border-box",
              }}
            />
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setShowPromptConfig(false)}>
                Cancel
              </button>
              <button
                className="btn-success"
                onClick={() => {
                  localStorage.setItem("grading_prompt", gradingPrompt);
                  setShowPromptConfig(false);
                }}
              >
                Save
              </button>
            </div>
            {/* Resize handle */}
            <div
              style={{
                height: 12,
                cursor: "ns-resize",
                width: "100%",
                position: "absolute",
                bottom: 0,
                left: 0,
                background: "linear-gradient(to top, #eee, transparent)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                userSelect: "none",
              }}
              onMouseDown={(e) => {
                setDragging(true);
                setDragStartY(e.clientY);
                setStartHeight(modalHeight);
              }}
            >
              <div style={{
                width: 40,
                height: 4,
                borderRadius: 2,
                background: "#bbb",
                margin: "4px 0",
              }} />
            </div>
          </div>
        </div>
      )}


      <div className="flex flex-1 w-full">
        {/* Left: Students */}
        <div className="panel flex-1 overflow-y-auto">
          <h2 className="panel-title">Student Submissions</h2>
          <div className="flex gap-2 mb-2">
            <input
              type="file"
              onChange={handleStudentUpload}
              className="input-file"
            />
            <button onClick={handlePasteStudent} className="btn-secondary">
              Add Pasted
            </button>
          </div>
          {students.length > 0 && (
            <>
              <div className="nav-bar">
                <button
                  className="btn-primary"
                  onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
                  disabled={currentIndex === 0}
                >
                  Prev
                </button>
                <span>
                  {currentIndex + 1} / {students.length} — {currentStudent?.name}
                </span>
                <button
                  className="btn-primary"
                  onClick={() =>
                    setCurrentIndex((i) =>
                      Math.min(students.length - 1, i + 1)
                    )
                  }
                  disabled={currentIndex === students.length - 1}
                >
                  Next
                </button>
              </div>
              <textarea
                className="textarea"
                value={currentStudent?.content || ""}
                onChange={(e) => {
                  updateStudent(currentIndex, {
                    content: e.target.value,
                    result: null,
                    status: "idle",
                    gradedAt: null,
                    elapsed: 0,
                  });
                }}
              />
            </>
          )}
        </div>

        {/* Middle: Answer Key */}
        <div className="panel flex-1 border-l border-r overflow-y-auto">
          <h2 className="panel-title">Answer Key</h2>
          <input
            type="file"
            onChange={handleAnswerKeyUpload}
            className="input-file"
          />
          <textarea
            className="textarea"
            value={answerKey}
            onChange={(e) => setAnswerKey(e.target.value)}
          />
        </div>

        {/* Right: Individual Evaluation */}
        <div className="panel flex-1 border-r overflow-y-auto">
          <h2 className="panel-title">Evaluation</h2>
          <div className="flex gap-2 mb-3">
            <button
              onClick={gradeCurrent}
              disabled={!answerKey || students.length === 0}
              className="btn-success"
            >
              Grade Current
            </button>
            <button
              onClick={gradeAll}
              disabled={!answerKey || students.length === 0}
              className="btn-primary"
            >
              Grade All
            </button>
          </div>

          {currentStudent && (
            <>
              <p>
                <strong>Status:</strong>{" "}
                <span
                  style={{
                    color:
                      currentStudent.status?.startsWith("processing")
                        ? "orange"
                        : currentStudent.status === "displayed"
                        ? "green"
                        : currentStudent.status === "error"
                        ? "red"
                        : "blue",
                  }}
                >
                  {currentStudent.status}
                </span>
              </p>

              {currentStudent.result &&
                currentStudent.status === "displayed" && (
                  <div className="result-box">
                    {currentStudent.result.error ? (
                      <p className="text-error">
                        {currentStudent.result.error}
                      </p>
                    ) : (
                      <>
                        <p>
                          <strong>Name:</strong>{" "}
                          {currentStudent.result.student_name ||
                            currentStudent.name}
                        </p>
                        {(() => {
                          const { total, worth, pct } = calculateTotals(
                            currentStudent.result
                          );
                          const pass = pct >= passThreshold;
                          return (
                            <p>
                              <strong>Total Score:</strong> {total} / {worth} (
                              {pct.toFixed(1)}%) —{" "}
                              {pass ? "✅ Pass" : "❌ Fail"} — Grade:{" "}
                              {getLetterGrade(pct)}
                            </p>
                          );
                        })()}
                        {currentStudent.result.questions?.map((q, idx) => (
                          <div key={idx} className="mb-3 border-b pb-2">
                            <p>
                              <strong>
                                Q{idx + 1}. {q.question}
                              </strong>
                            </p>
                            <p>
                              Answer: {q.student_answer} (
                              <span
                                style={{
                                  color:
                                    q.verdict === "Correct"
                                      ? "green"
                                      : q.verdict === "Partial"
                                      ? "orange"
                                      : "red",
                                }}
                              >
                                {q.verdict}
                              </span>
                              )
                            </p>
                            <p>Correct: {q.correct_answer}</p>
                            <p>Closeness: {q.closeness}%</p>
                            <p>Question Score: {q.questionscore}</p>
                          </div>
                        ))}
                        <p className="mt-2">
                          <strong>Feedback:</strong>{" "}
                          {currentStudent.result.feedback}
                        </p>
                      </>
                    )}
                  </div>
                )}
            </>
          )}
        </div>

        {/* Rightmost Column: Scores Overview */}
        <div className="panel flex-1 overflow-y-auto">
          <div className="flex justify-between items-center">
            <h2 className="panel-title">Scores Overview</h2>
            <button onClick={exportCSV} className="btn-primary text-sm">Export CSV</button>
          </div>

          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-white shadow">
              <tr>
                <th className="border px-2 py-1">Name</th>
                {students[0]?.result?.questions?.map((q) => (
                  <th key={q.id} className="border px-2 py-1">
                    {q.id}
                  </th>
                ))}
                <th className="border px-2 py-1">Final</th>
                <th className="border px-2 py-1">%</th>
                <th className="border px-2 py-1">✔/✘</th>
                <th className="border px-2 py-1">Grade</th>
              </tr>
            </thead>
            <tbody>
              {students.map(
                (s, idx) =>
                  s.result && (
                    <tr key={idx}>
                      <td
                        className="border px-2 py-1 cursor-pointer text-blue-600 underline"
                        onClick={() => setCurrentIndex(idx)}
                      >
                        {s.result.student_name || s.name}
                      </td>
                      {s.result.questions?.map((q, i) => (
                        <td key={i} className="border px-2 py-1 text-center">
                          {q.questionscore}
                        </td>
                      ))}
                      {(() => {
                        const { total, worth, pct } = calculateTotals(s.result);
                        const pass = pct >= passThreshold;
                        return (
                          <>
                            <td className="border px-2 py-1 text-center font-bold">
                              {total}
                            </td>
                            <td className="border px-2 py-1 text-center">
                              {pct.toFixed(1)}%
                            </td>
                            <td className="border px-2 py-1 text-center">
                              {pass ? "✅" : "❌"}
                            </td>
                            <td className="border px-2 py-1 text-center">
                              {getLetterGrade(pct)}
                            </td>
                          </>
                        );
                      })()}
                    </tr>
                  )
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
