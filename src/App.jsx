import React, { useState, useEffect } from "react";
import JSZip from "jszip";
import mammoth from "mammoth";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import "./App.css";

GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.worker.min.mjs";

// -------------------- Helpers --------------------
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

// -------------------- App --------------------
export default function App() {
  const [apiKey, setApiKey] = useState("");
  const [answerKey, setAnswerKey] = useState("");
  const [students, setStudents] = useState([]); // {name, content, result, status, gradedAt, elapsed}
  const [currentIndex, setCurrentIndex] = useState(0);

  // load saved key
  useEffect(() => {
    const saved = localStorage.getItem("openai_api_key");
    if (saved) setApiKey(saved);
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
      if (f.name.endsWith(".txt")) content = await readTxtFile(f);
      else if (f.name.endsWith(".docx")) content = await readDocxFile(f);
      else if (f.name.endsWith(".pdf")) content = await readPdfFile(f);
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
    } else {
      setStudents([await addStudent(file)]);
      setCurrentIndex(0);
    }
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
      updateStudent(index, { status: `processing (${seconds}s)`, elapsed: seconds });
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
            {
              role: "system",
              content:
                "You are a grading assistant. Compare student answers to the key and provide structured results. Don't get creative but do compare the answer from the key to the student's answer carefully and contextually, even if the wording is different - assign complete credit if answer answers the question conceptually, don't deduct points for spelling or if worded different. For each question, assign a closeness score (0-100) and a verdict (Correct, Partial, Incorrect) based on the closeness. The Question score should be the total score of the test divided by the number of the question except if the question itself states the points it is worth. For extracting the name, use the filename, first line of the submission or anything that has Name, Person or Student indication and chose the one that is most likely a name.",
            },
            {
              role: "user",
              content: `Key:\n${answerKey}\n\nStudent (${student.name}):\n${student.content}\n\nReturn JSON with structure:
{
  "total_score": number,
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

      // strip markdown fences
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

  // -------------------- Export CSV --------------------
  const exportCSV = () => {
    if (students.length === 0) return;

    // Collect all question ids across all students
    const qIds = new Set();
    students.forEach((s) => {
      s?.result?.questions?.forEach((q) => qIds.add(q.id));
    });
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
      const row = [s.name, s?.result?.total_score ?? ""];
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

  // -------------------- UI --------------------
  const currentStudent = students[currentIndex];

  return (
    <div className="h-screen flex flex-col">
      {/* API Key */}
      <div className="toolbar">
        <input
          type="password"
          placeholder="Enter OpenAI API Key"
          value={apiKey}
          onChange={handleApiKeyChange}
          className="input"
        />
      </div>

      <div className="flex flex-1">
        {/* Left: Students */}
        <div className="panel w-[30%]">
          <h2 className="panel-title">Student Submissions</h2>
          <div className="flex gap-2 mb-2">
            <input type="file" onChange={handleStudentUpload} className="input-file" />
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
                    setCurrentIndex((i) => Math.min(students.length - 1, i + 1))
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
        <div className="panel w-[30%] border-l border-r">
          <h2 className="panel-title">Answer Key</h2>
          <input type="file" onChange={handleAnswerKeyUpload} className="input-file" />
          <textarea
            className="textarea"
            value={answerKey}
            onChange={(e) => setAnswerKey(e.target.value)}
          />
        </div>

        {/* Right: Evaluation */}
        <div className="panel w-[40%]">
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
            <button
              onClick={exportCSV}
              disabled={students.length === 0}
              className="btn-secondary"
            >
              Export CSV
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
                      <p className="text-error">{currentStudent.result.error}</p>
                    ) : (
                      <>
                        <p>
                          <strong>Total Score:</strong>{" "}
                          {currentStudent.result.total_score}
                        </p>
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
                        {currentStudent.gradedAt && (
                          <p className="mt-2 text-sm">
                            <strong>Graded At:</strong>{" "}
                            {currentStudent.gradedAt}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
