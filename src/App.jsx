import { useEffect, useMemo, useState } from 'react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

const STORAGE_KEYS = {
  email: 'eval-cosep:email',
  firstName: 'eval-cosep:firstName',
  lastName: 'eval-cosep:lastName',
};

const DOCUMENT_LINKS = [
  {
    label: 'Cahier des charges (PDF)',
    href: '/documents/cahier-des-charges.pdf',
    description: 'Document principal à analyser.',
  },
  {
    label: 'Plan du projet (PDF)',
    href: '/documents/plan.pdf',
    description: 'Plan de situation AE-868.',
  },
];

const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const TEN_MINUTES_MS = 10 * 60 * 1000;

const formatDuration = (ms) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
};

const toBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });

const getScoreColor = (score) => {
  if (score >= 95) return '#22c55e'; // vert
  if (score >= 90) return '#f97316'; // orange
  return '#ef4444'; // rouge
};

const isValidEmail = (value = '') => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

export default function App() {
  const [email, setEmail] = useState(() => localStorage.getItem(STORAGE_KEYS.email) || '');
  const [firstName, setFirstName] = useState(() => localStorage.getItem(STORAGE_KEYS.firstName) || '');
  const [lastName, setLastName] = useState(() => localStorage.getItem(STORAGE_KEYS.lastName) || '');
  const [currentView, setCurrentView] = useState('identify');
  const [currentModule, setCurrentModule] = useState(null);
  const [user, setUser] = useState(null);
  const [progress, setProgress] = useState(null);
  const [authStatus, setAuthStatus] = useState('idle');
  const [authError, setAuthError] = useState('');
  const [progressError, setProgressError] = useState('');

  const participantLabel = useMemo(() => `${firstName.trim()} ${lastName.trim()}`.trim(), [firstName, lastName]);

  // Module 1: Extraction
  const [module1Started, setModule1Started] = useState(false);
  const [module1StartTime, setModule1StartTime] = useState(null);
  const [module1Elapsed, setModule1Elapsed] = useState(0);
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('idle');
  const [analysis, setAnalysis] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');

  // Module 2: Collaboration
  const [module2Started, setModule2Started] = useState(false);
  const [collabText, setCollabText] = useState('');
  const [collabStatus, setCollabStatus] = useState('idle');
  const [collabError, setCollabError] = useState('');
  const [collaboration, setCollaboration] = useState(null);

  // Module 3: Législation
  const [module3Started, setModule3Started] = useState(false);
  const [module3StartTime, setModule3StartTime] = useState(null);
  const [module3Elapsed, setModule3Elapsed] = useState(0);
  const [legalQ1, setLegalQ1] = useState('');
  const [legalQ2, setLegalQ2] = useState('');
  const [legalQ3, setLegalQ3] = useState('');
  const [legalStatus, setLegalStatus] = useState('idle');
  const [legalError, setLegalError] = useState('');
  const [legalResult, setLegalResult] = useState(null);

  // Module 4: Canvas
  const [module4Started, setModule4Started] = useState(false);
  const [canvasFile, setCanvasFile] = useState(null);
  const [canvasStatus, setCanvasStatus] = useState('idle');
  const [canvasError, setCanvasError] = useState('');
  const [canvasResult, setCanvasResult] = useState(null);

  // Chronos
  useEffect(() => {
    if (!module1StartTime) return;
    const id = setInterval(() => {
      setModule1Elapsed(Date.now() - module1StartTime);
    }, 1000);
    return () => clearInterval(id);
  }, [module1StartTime]);

  useEffect(() => {
    if (!module3StartTime) return;
    const id = setInterval(() => {
      setModule3Elapsed(Date.now() - module3StartTime);
    }, 1000);
    return () => clearInterval(id);
  }, [module3StartTime]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.email, email);
  }, [email]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.firstName, firstName);
  }, [firstName]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.lastName, lastName);
  }, [lastName]);

  const canStartApp = isValidEmail(email) && firstName.trim().length > 0 && lastName.trim().length > 0;

  const handleLogin = async (event) => {
    event.preventDefault();
    if (!canStartApp || authStatus === 'working') return;
    setAuthStatus('working');
    setAuthError('');
    try {
      const response = await fetch('/.netlify/functions/get-progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          firstName: firstName.trim(),
          lastName: lastName.trim(),
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Connexion impossible pour le moment.');
      }

      const data = await response.json();
      const resolvedEmail = data.user?.email?.trim() || email.trim();
      const resolvedFirstName = data.user?.firstName?.trim() || firstName.trim();
      const resolvedLastName = data.user?.lastName?.trim() || lastName.trim();

      setEmail(resolvedEmail);
      setFirstName(resolvedFirstName);
      setLastName(resolvedLastName);
      setUser({
        email: resolvedEmail,
        firstName: resolvedFirstName,
        lastName: resolvedLastName,
      });
      setProgress(data.progress || {});
      setProgressError('');
      setCurrentModule(null);
      setCurrentView('dashboard');
      setAuthStatus('success');
      setAuthError('');
    } catch (error) {
      console.error('Login error:', error);
      setAuthStatus('error');
      setAuthError(error.message || 'Connexion impossible pour le moment.');
    }
  };

  const resetModuleState = () => {
    setModule1Started(false);
    setModule1StartTime(null);
    setModule1Elapsed(0);
    setFile(null);
    setStatus('idle');
    setAnalysis(null);
    setErrorMessage('');
    setModule2Started(false);
    setCollabText('');
    setCollabStatus('idle');
    setCollabError('');
    setCollaboration(null);
    setModule3Started(false);
    setModule3StartTime(null);
    setModule3Elapsed(0);
    setLegalQ1('');
    setLegalQ2('');
    setLegalQ3('');
    setLegalStatus('idle');
    setLegalError('');
    setLegalResult(null);
    setModule4Started(false);
    setCanvasFile(null);
    setCanvasStatus('idle');
    setCanvasError('');
    setCanvasResult(null);
  };

  const handleLogout = () => {
    resetModuleState();
    setUser(null);
    setProgress(null);
    setCurrentModule(null);
    setCurrentView('identify');
    setAuthStatus('idle');
    setAuthError('');
    setProgressError('');
  };

  const persistModuleProgress = async (moduleId, updatePayload) => {
    if (!user?.email) return { success: false };
    try {
      const response = await fetch('/.netlify/functions/update-progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: user.email,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          updates: { [moduleId]: updatePayload },
        }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Sauvegarde impossible pour le moment.');
      }
      const data = await response.json();
      setProgress(data.progress || {});
      setProgressError('');
      return { success: true };
    } catch (error) {
      console.error('Progress sync error:', error);
      setProgressError("Sauvegarde Google Sheets indisponible. Merci de réessayer plus tard.");
      return { success: false, error };
    }
  };

  const openModule = (moduleId) => {
    if (isModuleLocked(moduleId)) {
      return;
    }
    setCurrentModule(moduleId);
    setCurrentView('module-detail');
  };

  const startModule = (moduleId) => {
    if (isModuleLocked(moduleId)) {
      setCurrentView('dashboard');
      setCurrentModule(null);
      return;
    }
    setCurrentView('module-active');
    if (moduleId === 'module1' && !module1Started) {
      setModule1Started(true);
      setModule1StartTime(Date.now());
    } else if (moduleId === 'module3' && !module3Started) {
      setModule3Started(true);
      setModule3StartTime(Date.now());
    } else if (moduleId === 'module2' && !module2Started) {
      setModule2Started(true);
    } else if (moduleId === 'module4' && !module4Started) {
      setModule4Started(true);
    }
  };

  const backToDashboard = () => {
    setCurrentView('dashboard');
    setCurrentModule(null);
  };

  const isModuleLocked = (moduleId) => progress?.[moduleId]?.status === 'completed';
  const getModuleScore = (moduleId) => {
    const entry = progress?.[moduleId];
    return typeof entry?.score === 'number' ? entry.score : null;
  };

  // Modules config
  const modules = [
    {
      id: 'module1',
      title: 'Extraction du cahier des charges',
      shortDesc: 'Analyse et extraction des données d\'un cahier des charges',
      completed: isModuleLocked('module1') || !!analysis,
      locked: isModuleLocked('module1'),
      score: getModuleScore('module1') ?? (typeof analysis?.score === 'number' ? analysis.score : null),
      timeLimit: '30 minutes',
    },
    {
      id: 'module2',
      title: 'Collaboration humain–IA',
      shortDesc: 'Évaluation de la qualité du dialogue avec l\'IA',
      completed: isModuleLocked('module2') || !!collaboration,
      locked: isModuleLocked('module2'),
      score: getModuleScore('module2') ?? (collaboration ? Math.round((collaboration.overall ?? 0) * 20) : null),
      timeLimit: 'Pas de limite',
    },
    {
      id: 'module3',
      title: 'Législation (recherche)',
      shortDesc: 'Recherche et interprétation réglementaire',
      completed: isModuleLocked('module3') || !!legalResult,
      locked: isModuleLocked('module3'),
      score: getModuleScore('module3') ?? (typeof legalResult?.score === 'number' ? legalResult.score : null),
      timeLimit: '10 minutes',
    },
    {
      id: 'module4',
      title: 'Preuve Canvas (ChatGPT)',
      shortDesc: 'Vérification de l\'accès à l\'outil Canvas',
      completed: isModuleLocked('module4') || !!canvasResult,
      locked: isModuleLocked('module4'),
      score: getModuleScore('module4') ?? (canvasResult ? (canvasResult.canvasDetected ? 100 : 0) : null),
      timeLimit: 'Pas de limite',
    },
  ];

  const currentModuleData = modules.find(m => m.id === currentModule);
  const currentModuleCompleted = currentModule ? isModuleLocked(currentModule) : false;
  const moduleLockedState = {
    module1: isModuleLocked('module1'),
    module2: isModuleLocked('module2'),
    module3: isModuleLocked('module3'),
    module4: isModuleLocked('module4'),
  };

  // Handler de réinitialisation
  // Handlers Module 1
  const handleFileChange = (event) => {
    setFile(event.target.files?.[0] || null);
    setErrorMessage('');
  };

  const handleSubmitModule1 = async (event) => {
    event.preventDefault();
    if (!file) {
      setErrorMessage('Merci de sélectionner un fichier Excel à analyser.');
      return;
    }
    if (!module1StartTime) {
      setErrorMessage('Le chronomètre doit être lancé avant la soumission.');
      return;
    }

    setStatus('working');
    setErrorMessage('');
    try {
      const fileContent = await toBase64(file);
      const submittedAt = Date.now();
      const payload = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        fileName: file.name,
        elapsedMs: module1Elapsed,
        startedAt: module1StartTime,
        submittedAt,
        fileContent,
      };

      const response = await fetch('/.netlify/functions/analyze-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Analyse impossible pour le moment.');
      }

      const result = await response.json();
      setAnalysis(result);
      setStatus('success');
      if (user?.email) {
        await persistModuleProgress('module1', {
          status: 'completed',
          score: result.score ?? null,
          elapsedMs: module1Elapsed,
          submittedAt,
        });
      }
    } catch (error) {
      console.error(error);
      setStatus('error');
      setErrorMessage(error.message || 'Une erreur est survenue pendant la soumission.');
    }
  };

  // Handlers Module 2
  const handleCollabPaste = (event) => {
    const { clipboardData } = event;
    if (!clipboardData) return;

    const html = clipboardData.getData('text/html');
    if (!html) return;

    event.preventDefault();
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      doc.querySelectorAll('script,style,button').forEach((node) => node.remove());
      const text = doc.body.innerText
        .replace(/\u00a0/g, ' ')
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      if (!text) return;

      setCollabText((prev) => {
        const prefix = prev.trim().length > 0 ? `${prev.trimEnd()}\n\n` : '';
        return `${prefix}${text}`;
      });
      setCollabError('');
    } catch (error) {
      console.warn('Impossible de parser le contenu HTML du presse-papiers', error);
      const plain = clipboardData.getData('text/plain');
      if (plain) {
        setCollabText((prev) => {
          const prefix = prev.trim().length > 0 ? `${prev.trimEnd()}\n\n` : '';
          return `${prefix}${plain}`;
        });
      }
    }
  };

  const handleSubmitModule2 = async (event) => {
    event.preventDefault();
    if (!collabText.trim()) {
      setCollabError("Veuillez coller la conversation complète avec l'IA avant de lancer l'analyse.");
      return;
    }

    setCollabStatus('working');
    setCollabError('');

    try {
      const submittedAt = Date.now();
      const payload = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        transcript: collabText.trim(),
        extractionScore: analysis?.score ?? 0,
        submittedAt,
      };

      const response = await fetch('/.netlify/functions/analyze-collaboration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Impossible d'analyser la collaboration pour le moment.");
      }

      const result = await response.json();
      setCollaboration(result);
      setCollabStatus('success');
      setCollabError('');
      if (user?.email) {
        await persistModuleProgress('module2', {
          status: 'completed',
          score: Math.round((result.overall ?? 0) * 20),
          submittedAt,
        });
      }
    } catch (error) {
      console.error(error);
      setCollabStatus('error');
      setCollabError(error.message || "Analyse collaboration impossible pour le moment.");
    }
  };

  // Handlers Module 3
  const handleSubmitModule3 = async () => {
    setLegalStatus('working');
    setLegalError('');
    try {
      const submittedAt = Date.now();
      const elapsedMs = module3StartTime ? submittedAt - module3StartTime : 0;
      const payload = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        answers: { Q1: legalQ1, Q2: legalQ2, Q3: legalQ3 },
        startedAt: module3StartTime,
        submittedAt,
        elapsedMs,
      };
      const res = await fetch('/.netlify/functions/evaluate-legal-training', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setLegalResult(json);
      setLegalStatus('success');
      if (user?.email) {
        await persistModuleProgress('module3', {
          status: 'completed',
          score: json.score ?? null,
          elapsedMs,
          submittedAt,
        });
      }
    } catch (err) {
      setLegalError(err.message || "Erreur pendant l'évaluation.");
      setLegalStatus('error');
    }
  };

  // Handlers Module 4
  const handleCanvasFileChange = (event) => {
    setCanvasFile(event.target.files?.[0] || null);
    setCanvasError('');
  };

  const handleSubmitModule4 = async (event) => {
    event.preventDefault();
    if (!canvasFile) {
      setCanvasError("Merci de sélectionner une capture d'écran.");
      return;
    }
    try {
      setCanvasStatus('working');
      setCanvasError('');
      const fileContent = await toBase64(canvasFile);
      const submittedAt = Date.now();
      const payload = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        imageContent: fileContent,
        mimeType: canvasFile.type || 'image/png',
        submittedAt,
      };
      const res = await fetch('/.netlify/functions/detect-canvas-icon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setCanvasResult(json);
      setCanvasStatus('success');
      if (user?.email) {
        await persistModuleProgress('module4', {
          status: 'completed',
          score: json.canvasDetected ? 100 : 0,
          submittedAt,
        });
      }
    } catch (err) {
      setCanvasStatus('error');
      setCanvasError(err.message || 'Analyse impossible pour le moment.');
    }
  };

  // PDF Generation
  const handleDownloadPdf = () => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const marginX = 48;
    const headerHeight = 88;

    doc.setFillColor(16, 47, 93);
    doc.rect(0, 0, pageWidth, headerHeight, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.text('EVAL COSEP — Rapport d\'évaluation', marginX, 40);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text(`Participant : ${participantLabel || 'Non renseigné'}`, marginX, 60);
    doc.text(`Date : ${new Date().toLocaleString()}`, marginX, 76);

    doc.setTextColor(33, 37, 41);
    let cursorY = headerHeight + 28;

    // Résumé de tous les modules
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('Résumé des modules', marginX, cursorY);
    cursorY += 20;

    const summaryRows = modules.map((m) => [
      m.title,
      typeof m.score === 'number' ? `${m.score.toFixed(1)}%` : 'Non réalisé',
      m.completed ? '✓' : '—',
    ]);

    doc.autoTable({
      startY: cursorY,
      head: [['Module', 'Score', 'Statut']],
      body: summaryRows,
      theme: 'striped',
      headStyles: { fillColor: [16, 47, 93], textColor: 255, fontStyle: 'bold' },
      styles: { fontSize: 11, cellPadding: 8, textColor: [33, 37, 41] },
      alternateRowStyles: { fillColor: [246, 249, 255] },
      columnStyles: {
        0: { cellWidth: 300 },
        1: { cellWidth: 100, halign: 'center' },
        2: { cellWidth: 100, halign: 'center' }
      }
    });

    cursorY = doc.lastAutoTable.finalY + 24;

    // Module 1
    if (analysis) {
      if (cursorY > 660) { doc.addPage(); cursorY = 72; }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text('Module 1 — Extraction du cahier des charges', marginX, cursorY);
      cursorY += 20;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.text(`Score: ${(analysis.score ?? 0).toFixed(1)}%`, marginX, cursorY);
      cursorY += 14;
      doc.text(`Temps: ${analysis.elapsed?.formatted ?? formatDuration(module1Elapsed)}`, marginX, cursorY);
      cursorY += 18;

      const extractionRows = analysis.details?.length
        ? analysis.details.map((detail) => [detail.section, detail.score !== undefined ? `${detail.score}%` : 'N/A', detail.message])
        : [['Toutes les sections attendues', '100%', 'Aucun écart détecté']];

      doc.autoTable({
        startY: cursorY,
        head: [['Section', 'Score', 'Commentaire']],
        body: extractionRows,
        theme: 'striped',
        headStyles: { fillColor: [0, 88, 255], textColor: 255, fontStyle: 'bold' },
        styles: { fontSize: 10, cellPadding: 6, textColor: [33, 37, 41], overflow: 'linebreak' },
        alternateRowStyles: { fillColor: [246, 249, 255] },
        columnStyles: {
          0: { cellWidth: 200 },
          1: { cellWidth: 70, halign: 'center' },
          2: { cellWidth: 230, overflow: 'linebreak' }
        }
      });
      cursorY = doc.lastAutoTable.finalY + 18;
    }

    // Module 2
    if (collaboration) {
      if (cursorY > 660) { doc.addPage(); cursorY = 72; }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text('Module 2 — Collaboration humain–IA', marginX, cursorY);
      cursorY += 20;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.text(`Score global: ${collaboration.overall?.toFixed(1) ?? '0.0'}/5 (${Math.round((collaboration.overall ?? 0) * 20)}%)`, marginX, cursorY);
      cursorY += 18;

      const collabRows = Object.values(collaboration.scores || {}).map((value) => [
        value.label || '-',
        `${value.score.toFixed(1)}/5`,
        value.comment
      ]);

      if (collabRows.length) {
        doc.autoTable({
          startY: cursorY,
          head: [['Critère', 'Score', 'Commentaire']],
          body: collabRows,
          theme: 'striped',
          headStyles: { fillColor: [29, 42, 74], textColor: 255, fontStyle: 'bold' },
          styles: { fontSize: 10, cellPadding: 6, textColor: [33, 37, 41], overflow: 'linebreak' },
          alternateRowStyles: { fillColor: [246, 248, 255] },
          columnStyles: {
            0: { cellWidth: 140 },
            1: { cellWidth: 90, halign: 'center' },
            2: { cellWidth: 270, overflow: 'linebreak' }
          }
        });
        cursorY = doc.lastAutoTable.finalY + 18;
      }
    }

    // Module 3
    if (legalResult) {
      if (cursorY > 660) { doc.addPage(); cursorY = 72; }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text('Module 3 — Législation', marginX, cursorY);
      cursorY += 20;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.text(`Score: ${(legalResult.score ?? 0).toFixed(1)}%`, marginX, cursorY);
      cursorY += 18;

      const legalRows = (legalResult.details || []).map((d) => [d.questionId, `${d.score}%`, d.comment]);

      doc.autoTable({
        startY: cursorY,
        head: [['Question', 'Score', 'Commentaire']],
        body: legalRows,
        theme: 'striped',
        headStyles: { fillColor: [0, 118, 255], textColor: 255, fontStyle: 'bold' },
        styles: { fontSize: 10, cellPadding: 6, textColor: [33, 37, 41], overflow: 'linebreak' },
        alternateRowStyles: { fillColor: [246, 249, 255] },
        columnStyles: {
          0: { cellWidth: 90 },
          1: { cellWidth: 60, halign: 'center' },
          2: { cellWidth: 350, overflow: 'linebreak' }
        }
      });
      cursorY = doc.lastAutoTable.finalY + 18;
    }

    // Module 4
    if (canvasResult) {
      if (cursorY > 720) { doc.addPage(); cursorY = 72; }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text('Module 4 — Preuve Canvas', marginX, cursorY);
      cursorY += 20;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      const presence = canvasResult.canvasDetected ? 'Présente ✓' : 'Absente ✗';
      const conf = typeof canvasResult.confidence === 'number' ? Math.round(canvasResult.confidence * 100) : 0;
      doc.text(`Détection icône Canvas: ${presence} (confiance ${conf}%)`, marginX, cursorY);
      cursorY += 14;
      if (canvasResult.evidence) {
        const ev = doc.splitTextToSize(`Indice: ${canvasResult.evidence}`, pageWidth - marginX * 2);
        doc.text(ev, marginX, cursorY);
      }
    }

    const safeName = participantLabel.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase() || 'participant';
    doc.save(`eval-cosep-${safeName}.pdf`);
  };

  // === RENDER ===

  // Écran d'identification
  if (currentView === 'identify') {
    return (
      <div className="layout">
        <main className="page">
          <div className="card">
            <h1>EVAL COSEP</h1>
            <p>Bienvenue dans l'évaluation COSEP. Identifiez-vous pour accéder aux modules.</p>
            <form className="form-vertical" onSubmit={handleLogin}>
              <label>
                Adresse email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="prenom.nom@exemple.com"
                  required
                />
              </label>
              <div className="form-row">
                <label>
                  Prénom
                  <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
                </label>
                <label>
                  Nom
                  <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
                </label>
              </div>
              {authError && <p className="error-text">{authError}</p>}
              <button className="primary" type="submit" disabled={!canStartApp || authStatus === 'working'}>
                {authStatus === 'working' ? 'Connexion en cours...' : 'Accéder aux modules'}
              </button>
            </form>
          </div>
        </main>
      </div>
    );
  }

  // Dashboard principal
  if (currentView === 'dashboard') {
    const hasAnyResult = modules.some((module) => module.completed);

    return (
      <div className="layout">
        <main className="page">
          <div className="card">
            <h1>EVAL COSEP — Modules</h1>
            <p className="participant-name">
              Connecté en tant que <strong>{participantLabel}</strong> ({user?.email})
            </p>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '1rem' }}>
              {hasAnyResult && (
                <button type="button" className="primary download-main" onClick={handleDownloadPdf}>
                  Télécharger le rapport d'évaluation (PDF)
                </button>
              )}
              <button type="button" className="secondary" onClick={handleLogout}>
                Se déconnecter
              </button>
            </div>
            {progressError && (
              <p style={{ color: '#b45309', marginTop: '0.75rem' }}>{progressError}</p>
            )}
          </div>

          <div className="modules-grid">
            {modules.map((module) => (
              <div
                key={module.id}
                className={`module-card ${module.completed ? 'completed' : ''}`}
                onClick={() => !module.locked && openModule(module.id)}
                style={{
                  cursor: module.locked ? 'not-allowed' : 'pointer',
                  opacity: module.locked ? 0.7 : 1
                }}
              >
                <div className="module-header">
                  <h3>{module.title}</h3>
                  {typeof module.score === 'number' && (
                    <div
                      className="module-score-badge"
                      style={{ backgroundColor: getScoreColor(module.score) }}
                    >
                      {module.score.toFixed(1)}%
                    </div>
                  )}
                </div>
                <p className="module-short-desc">{module.shortDesc}</p>
                {module.completed && (
                  <div className="module-completed-label">
                    ✓ Terminé {module.locked ? '(verrouillé)' : '(session en cours)'}
                  </div>
                )}
              </div>
            ))}
          </div>
        </main>
      </div>
    );
  }

  // Détail du module (avant démarrage)
  if (currentView === 'module-detail' && currentModuleData) {
    return (
      <div className="layout">
        <main className="page">
          <div className="card">
            <button className="back-button" onClick={backToDashboard}>← Retour au menu</button>
            <h1>{currentModuleData.title}</h1>

            {currentModule === 'module1' && currentModuleCompleted && (
              <div className="alert info">
                Ce module a déjà été complété. Merci de revenir au menu pour consulter votre score.
              </div>
            )}
            {currentModule === 'module1' && !currentModuleCompleted && (
              <>
                <p>
                  Analysez les documents fournis et extrayez toutes les informations nécessaires.
                  Déposez ensuite votre synthèse sous forme de fichier Excel.
                </p>
                <p><strong>Durée:</strong> {currentModuleData.timeLimit}</p>
                <p>Le chronomètre démarre dès que vous cliquez sur "Démarrer le module".</p>
                <div className="pad-top">
                  <p>Documents disponibles :</p>
                  <div className="links">
                    {DOCUMENT_LINKS.map((doc) => (
                      <div key={doc.label} className="link-item">
                        <a href={doc.href} target="_blank" rel="noreferrer">
                          {doc.label}
                        </a>
                        <span className="link-description">{doc.description}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {currentModule === 'module2' && currentModuleCompleted && (
              <div className="alert info">
                Ce module a déjà été complété. Merci de revenir au menu pour consulter votre score.
              </div>
            )}
            {currentModule === 'module2' && !currentModuleCompleted && (
              <>
                <p>
                  Collez l'intégralité de votre échange avec une IA (ChatGPT, Gemini, etc.).
                  Le système analyse la qualité de votre collaboration.
                </p>
                <p><strong>Durée:</strong> {currentModuleData.timeLimit}</p>
              </>
            )}

            {currentModule === 'module3' && currentModuleCompleted && (
              <div className="alert info">
                Ce module a déjà été complété. Merci de revenir au menu pour consulter votre score.
              </div>
            )}
            {currentModule === 'module3' && !currentModuleCompleted && (
              <>
                <p>
                  Recherchez et interprétez la réglementation relative à la formation de base en sécurité
                  sur les chantiers (AR 7 avril 2023, CP 124, CCT, Constructiv/VCA).
                </p>
                <p><strong>Durée:</strong> {currentModuleData.timeLimit}</p>
                <p>Le chronomètre démarre dès que vous cliquez sur "Démarrer le module".</p>
              </>
            )}

            {currentModule === 'module4' && currentModuleCompleted && (
              <div className="alert info">
                Ce module a déjà été complété. Merci de revenir au menu pour consulter votre score.
              </div>
            )}
            {currentModule === 'module4' && !currentModuleCompleted && (
              <>
                <p>
                  Chargez une capture d'écran montrant la zone de saisie de ChatGPT.
                  L'outil détecte si l'icône <em>Canvas</em> est présente.
                </p>
                <p><strong>Durée:</strong> {currentModuleData.timeLimit}</p>
              </>
            )}

            <button className="primary" onClick={() => startModule(currentModule)}>
              Démarrer le module
            </button>
          </div>
        </main>
      </div>
    );
  }

  // Module actif
  if (currentView === 'module-active' && currentModuleData) {
    return (
      <div className="layout">
        <main className="page">

          {/* MODULE 1 */}
          {currentModule === 'module1' && (
            <>
              <div className="card">
                <h2>Module 1 — Extraction du cahier des charges</h2>
                <div className="timer">
                  Temps écoulé: {formatDuration(module1Elapsed)} {module1Elapsed > THIRTY_MINUTES_MS ? '(hors délai)' : ''}
                </div>
                <p>Préparez votre analyse dans Excel et déposez votre fichier ci-dessous.</p>
              </div>

              {!moduleLockedState.module1 && !analysis && (
                <div className="card">
                  <h3>Déposez votre fichier Excel</h3>
                  <form onSubmit={handleSubmitModule1}>
                    <div className="upload-zone">
                      <p>Glissez votre fichier Excel ici ou utilisez le sélecteur.</p>
                      <input type="file" accept=".xls,.xlsx" onChange={handleFileChange} />
                    </div>
                    <button className="primary pad-top" type="submit" disabled={status === 'working'}>
                      {status === 'working' ? 'Analyse en cours…' : 'Lancer l\'analyse'}
                    </button>
                  </form>
                  {errorMessage && <div className="error">{errorMessage}</div>}
                </div>
              )}

              {moduleLockedState.module1 && !analysis && (
                <div className="card">
                  <div className="alert info">
                    Ce module est verrouillé car une évaluation existe déjà. Retournez au menu pour consulter vos scores.
                  </div>
                  <button type="button" className="primary" onClick={backToDashboard}>
                    Retour au menu
                  </button>
                </div>
              )}

              {analysis && (
                <div className="card">
                  <h3>Résultat</h3>
                  <div className="results">
                    <div className="results-header">
                      <div>
                        <p className="participant">{participantLabel}</p>
                        <p className="timestamp">Soumis le {new Date().toLocaleString()}</p>
                      </div>
                      <div
                        className="score-badge"
                        style={{ backgroundColor: getScoreColor(analysis.score) }}
                      >
                        {analysis.score?.toFixed(1) ?? '0.0'}%
                      </div>
                    </div>
                    {analysis.details?.length ? (
                      <div className="details-table">
                        <div className="details-header">
                          <span>Section</span>
                          <span>Score</span>
                          <span>Commentaire</span>
                        </div>
                        {analysis.details.map((detail) => (
                          <div key={`${detail.section}-${detail.message}`} className="details-row">
                            <span className="details-section">{detail.section}</span>
                            <span className="details-score">{detail.score ?? 'N/A'}%</span>
                            <span className="details-comment">{detail.message}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p>Toutes les sections attendues ont été retrouvées.</p>
                    )}
                  </div>
                  <button type="button" className="primary" onClick={backToDashboard}>
                    Retour au menu
                  </button>
                </div>
              )}
            </>
          )}

          {/* MODULE 2 */}
          {currentModule === 'module2' && (
            <>
              {!moduleLockedState.module2 && !collaboration && (
                <div className="card">
                  <h2>Module 2 — Collaboration humain–IA</h2>
                  <p>Collez ci-dessous l'intégralité de votre échange avec l'IA.</p>
                  <form onSubmit={handleSubmitModule2}>
                    <textarea
                      value={collabText}
                      onChange={(e) => setCollabText(e.target.value)}
                      onPaste={handleCollabPaste}
                      placeholder="Collez ici votre conversation complète."
                      rows={14}
                    />
                    <button className="primary" type="submit" disabled={collabStatus === 'working'}>
                      {collabStatus === 'working' ? 'Analyse en cours…' : 'Analyser la collaboration'}
                    </button>
                  </form>
                  {collabError && <div className="error">{collabError}</div>}
                </div>
              )}

              {moduleLockedState.module2 && !collaboration && (
                <div className="card">
                  <div className="alert info">
                    Ce module est verrouillé car une évaluation existe déjà. Retournez au menu pour consulter vos scores.
                  </div>
                  <button type="button" className="primary" onClick={backToDashboard}>
                    Retour au menu
                  </button>
                </div>
              )}

              {collaboration && (
                <div className="card">
                  <h3>Résultat</h3>
                  <div className="collab-results">
                    <div className="collab-overview">
                      <span className="collab-overall">
                        Score global: {collaboration.overall?.toFixed(1) ?? '0.0'}/5 ({Math.round((collaboration.overall ?? 0) * 20)}%)
                      </span>
                    </div>
                    <div className="collab-table">
                      <div className="collab-header">
                        <span>Critère</span>
                        <span>Score</span>
                        <span>Commentaire</span>
                      </div>
                      {Object.entries(collaboration.scores || {}).map(([key, value]) => (
                        <div key={key} className="collab-row">
                          <span className="collab-criterion">{value.label || key}</span>
                          <span className="collab-score">{value.score.toFixed(1)}/5</span>
                          <span className="collab-comment">{value.comment}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <button type="button" className="primary" onClick={backToDashboard}>
                    Retour au menu
                  </button>
                </div>
              )}
            </>
          )}

          {/* MODULE 3 */}
          {currentModule === 'module3' && (
            <>
              {!moduleLockedState.module3 && !legalResult && (
                <div className="card">
                  <h2>Module 3 — Législation</h2>
                  <div className="timer">
                    Temps écoulé: {formatDuration(module3Elapsed)} {module3Elapsed > TEN_MINUTES_MS ? '(hors délai)' : ''}
                  </div>
                  <p>Répondez aux 3 questions ci-dessous concernant la réglementation.</p>

                  <div className="pad-top">
                    <label>
                      Q1 — Objectif et champ d'application (AR 7 avril 2023)
                      <textarea rows={5} value={legalQ1} onChange={(e) => setLegalQ1(e.target.value)} placeholder="Votre réponse" />
                    </label>
                  </div>
                  <div className="pad-top">
                    <label>
                      Q2 — Contenu et durée minimales (CP 124)
                      <textarea rows={5} value={legalQ2} onChange={(e) => setLegalQ2(e.target.value)} placeholder="Votre réponse" />
                    </label>
                  </div>
                  <div className="pad-top">
                    <label>
                      Q3 — Équivalences et dispenses (CCT + AR)
                      <textarea rows={5} value={legalQ3} onChange={(e) => setLegalQ3(e.target.value)} placeholder="Votre réponse" />
                    </label>
                  </div>

                  <button className="primary pad-top" type="button" disabled={legalStatus === 'working'} onClick={handleSubmitModule3}>
                    {legalStatus === 'working' ? 'Évaluation en cours…' : 'Soumettre'}
                  </button>
                  {legalError && <div className="error">{legalError}</div>}
                </div>
              )}

              {moduleLockedState.module3 && !legalResult && (
                <div className="card">
                  <div className="alert info">
                    Ce module est verrouillé car une évaluation existe déjà. Retournez au menu pour consulter vos scores.
                  </div>
                  <button type="button" className="primary" onClick={backToDashboard}>
                    Retour au menu
                  </button>
                </div>
              )}

              {legalResult && (
                <div className="card">
                  <h3>Résultat</h3>
                  <div className="results">
                    <div className="results-header">
                      <div>
                        <p className="participant">Score module 3</p>
                      </div>
                      <div
                        className="score-badge"
                        style={{ backgroundColor: getScoreColor(legalResult.score) }}
                      >
                        {(legalResult.score ?? 0).toFixed(1)}%
                      </div>
                    </div>
                    <div className="details-table">
                      <div className="details-header"><span>Question</span><span>Score</span><span>Commentaire</span></div>
                      {legalResult.details?.map((d) => (
                        <div key={d.questionId} className="details-row">
                          <span className="details-section">{d.questionId}</span>
                          <span className="details-score">{d.score}%</span>
                          <span className="details-comment">{d.comment}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <button type="button" className="primary" onClick={backToDashboard}>
                    Retour au menu
                  </button>
                </div>
              )}
            </>
          )}

          {/* MODULE 4 */}
          {currentModule === 'module4' && (
            <>
              {!moduleLockedState.module4 && !canvasResult && (
                <div className="card">
                  <h2>Module 4 — Preuve Canvas (ChatGPT)</h2>
                  <p>Chargez une capture d'écran montrant la zone de saisie de ChatGPT avec l'icône Canvas.</p>
                  <form onSubmit={handleSubmitModule4}>
                    <div className="upload-zone">
                      <p>Glissez votre capture ici ou utilisez le sélecteur.</p>
                      <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleCanvasFileChange} />
                    </div>
                    <button className="primary pad-top" type="submit" disabled={canvasStatus === 'working'}>
                      {canvasStatus === 'working' ? 'Analyse en cours…' : 'Vérifier'}
                    </button>
                  </form>
                  {canvasError && <div className="error">{canvasError}</div>}
                </div>
              )}

              {moduleLockedState.module4 && !canvasResult && (
                <div className="card">
                  <div className="alert info">
                    Ce module est verrouillé car une évaluation existe déjà. Retournez au menu pour consulter vos scores.
                  </div>
                  <button type="button" className="primary" onClick={backToDashboard}>
                    Retour au menu
                  </button>
                </div>
              )}

              {canvasResult && (
                <div className="card">
                  <h3>Résultat</h3>
                  <div className="results">
                    <div className="results-header">
                      <div>
                        <p className="participant">Détection Canvas</p>
                        <p className="timestamp">
                          {canvasResult.canvasDetected ? 'Icône détectée ✅' : 'Icône non détectée ❌'}
                          {typeof canvasResult.confidence === 'number' && (
                            <span> — confiance {Math.round(canvasResult.confidence * 100)}%</span>
                          )}
                        </p>
                      </div>
                    </div>
                    {canvasResult.evidence && <p className="status">{canvasResult.evidence}</p>}
                  </div>
                  <button type="button" className="primary" onClick={backToDashboard}>
                    Retour au menu
                  </button>
                </div>
              )}
            </>
          )}

        </main>
      </div>
    );
  }

  return null;
}
