import { useEffect, useMemo, useState } from 'react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

const STORAGE_KEYS = {
  firstName: 'eval-cosep:firstName',
  lastName: 'eval-cosep:lastName',
  startTime: 'eval-cosep:startTime',
  phase: 'eval-cosep:phase',
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

export default function App() {
  const [firstName, setFirstName] = useState(() => localStorage.getItem(STORAGE_KEYS.firstName) || '');
  const [lastName, setLastName] = useState(() => localStorage.getItem(STORAGE_KEYS.lastName) || '');
  const [phase, setPhase] = useState(() => localStorage.getItem(STORAGE_KEYS.phase) || 'identify');
  const [startTime, setStartTime] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.startTime);
    return saved ? Number(saved) : null;
  });
  const [elapsedMs, setElapsedMs] = useState(() => {
    const savedStart = localStorage.getItem(STORAGE_KEYS.startTime);
    return savedStart ? Date.now() - Number(savedStart) : 0;
  });
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | working | success | error
  const [analysis, setAnalysis] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const participantLabel = useMemo(() => `${firstName.trim()} ${lastName.trim()}`.trim(), [firstName, lastName]);
  const [collabText, setCollabText] = useState('');
  const [collabStatus, setCollabStatus] = useState('idle');
  const [collabError, setCollabError] = useState('');
  const [collaboration, setCollaboration] = useState(null);
  // Module 3: Législation
  const [legalQ1, setLegalQ1] = useState('');
  const [legalQ2, setLegalQ2] = useState('');
  const [legalQ3, setLegalQ3] = useState('');
  const [legalStatus, setLegalStatus] = useState('idle'); // idle | working | success | error
  const [legalError, setLegalError] = useState('');
  const [legalResult, setLegalResult] = useState(null);
  const [legalStart, setLegalStart] = useState(null);
  const [legalElapsed, setLegalElapsed] = useState(0);

  useEffect(() => {
    if (!startTime) {
      return;
    }

    const intervalId = setInterval(() => {
      setElapsedMs(Date.now() - startTime);
    }, 1000);

    return () => clearInterval(intervalId);
  }, [startTime]);

  // Chrono module 3 (10 min)
  useEffect(() => {
    if (!legalStart) return;
    const id = setInterval(() => {
      setLegalElapsed(Date.now() - legalStart);
    }, 1000);
    return () => clearInterval(id);
  }, [legalStart]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.firstName, firstName);
  }, [firstName]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.lastName, lastName);
  }, [lastName]);

  const hasExceededTime = elapsedMs > THIRTY_MINUTES_MS;
  const formattedElapsed = useMemo(() => formatDuration(elapsedMs), [elapsedMs]);

  const canStartMission = phase === 'identify' && firstName.trim().length > 0 && lastName.trim().length > 0;

  const handleStartMission = () => {
    if (!canStartMission) {
      return;
    }
    const now = Date.now();
    setStartTime(now);
    setPhase('mission');
    localStorage.setItem(STORAGE_KEYS.phase, 'mission');
    localStorage.setItem(STORAGE_KEYS.startTime, String(now));
    setElapsedMs(0);
  };

  const handleFileChange = (event) => {
    setFile(event.target.files?.[0] || null);
    setErrorMessage('');
    setAnalysis(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!file) {
      setErrorMessage('Merci de sélectionner un fichier Excel à analyser.');
      return;
    }
    if (!startTime) {
      setErrorMessage('Le chronomètre doit être lancé avant la soumission.');
      return;
    }

    setStatus('working');
    setErrorMessage('');
    try {
      const fileContent = await toBase64(file);
      const payload = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        fileName: file.name,
        elapsedMs,
        startedAt: startTime,
        submittedAt: Date.now(),
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
      if (result?.sheet) {
        console.info('Résultat Google Sheet:', result.sheet);
      }
      if (result?.storage) {
        console.info('Archivage du fichier:', result.storage);
      }
      setAnalysis(result);
      setStatus('success');
      setPhase('submitted');
      localStorage.setItem(STORAGE_KEYS.phase, 'submitted');
    } catch (error) {
      console.error(error);
      setStatus('error');
      setErrorMessage(error.message || 'Une erreur est survenue pendant la soumission.');
    }
  };

  const handleDownloadPdf = () => {
    if (!analysis) {
      return;
    }

    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const marginX = 48;
    const headerHeight = 88;

    doc.setFillColor(16, 47, 93);
    doc.rect(0, 0, pageWidth, headerHeight, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.text('EVAL COSEP — Rapport d’évaluation', marginX, 40);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text(`Participant : ${participantLabel || 'Non renseigné'}`, marginX, 60);
    doc.text(
      `Soumission : ${
        analysis.elapsed?.submittedAt ? new Date(analysis.elapsed.submittedAt).toLocaleString() : new Date().toLocaleString()
      }`,
      marginX,
      76
    );

    doc.setTextColor(33, 37, 41);
    let cursorY = headerHeight + 28;

    const overallPct = Math.round((collaboration?.overall ?? 0) * 20);
    const statCards = [
      {
        title: 'Module 1 — Extraction',
        value: `${(analysis.score ?? 0).toFixed(1)}%`,
        subtitle: 'Conformité au référentiel',
        color: [0, 88, 255],
      },
      {
        title: 'Module 2 — Collaboration',
        value: `${overallPct}%`,
        subtitle: 'Qualité humain–IA',
        color: [23, 125, 91],
      },
      {
        title: 'Module 3 — Législation',
        value: `${(legalResult?.score ?? 0).toFixed(1)}%`,
        subtitle: 'Recherche + interprétation',
        color: [0, 118, 255],
      },
    ];

    const cardWidth = 170;
    const cardHeight = 86;
    const cardGap = 18;

    const drawStatCard = (x, y, { title, value, subtitle, color }) => {
      // Fond très clair pour lisibilité
      doc.setFillColor(240, 246, 255);
      doc.setDrawColor(color[0], color[1], color[2]);
      doc.roundedRect(x, y, cardWidth, cardHeight, 12, 12, 'FD');
      // Titre en couleur, valeurs en sombre
      doc.setTextColor(color[0], color[1], color[2]);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text(title, x + 16, y + 24);
      doc.setTextColor(33, 37, 41);
      doc.setFontSize(26);
      doc.text(value, x + 16, y + 54);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.text(subtitle, x + 16, y + 72);
      doc.setTextColor(33, 37, 41);
    };

    statCards.forEach((card, index) => {
      const x = marginX + index * (cardWidth + cardGap);
      drawStatCard(x, cursorY, card);
    });

    cursorY += cardHeight + 22;

    // Afficher la durée de l'exercice sous les encadrés des scores
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(90, 99, 122);
    doc.text(
      `Durée de l’exercice: ${analysis.elapsed?.formatted ?? formattedElapsed}${hasExceededTime ? ' (hors délai)' : ''}`,
      marginX,
      cursorY
    );
    cursorY += 18;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('Analyse extraction', marginX, cursorY);
    cursorY += 20;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(90, 99, 122);
    doc.text('Comparaison des réponses fournies avec le référentiel validé.', marginX, cursorY);
    doc.setTextColor(33, 37, 41);
    cursorY += 18;

    const extractionRows = analysis.details?.length
      ? analysis.details.map((detail) => [
          detail.section,
          detail.score !== undefined ? `${detail.score}%` : 'N/A',
          detail.message,
        ])
      : [['Toutes les sections attendues', '100%', 'Aucun écart détecté']];

    doc.autoTable({
      startY: cursorY,
      head: [['Section', 'Score', 'Commentaire']],
      body: extractionRows,
      theme: 'striped',
      headStyles: { fillColor: [0, 88, 255], textColor: 255, fontStyle: 'bold' },
      styles: {
        fontSize: 10,
        cellPadding: 6,
        textColor: [33, 37, 41],
        lineColor: [226, 232, 240],
        lineWidth: 0.2,
        overflow: 'linebreak',
      },
      alternateRowStyles: { fillColor: [246, 249, 255] },
      columnStyles: {
        0: { cellWidth: 200 },
        1: { cellWidth: 70, halign: 'center' },
        2: { cellWidth: 230, overflow: 'linebreak', valign: 'top' },
      },
    });

    cursorY = doc.lastAutoTable.finalY + 18;

    if (analysis.storage || analysis.sheet) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text('Traçabilité', marginX, cursorY);
      cursorY += 16;
      doc.setFont('helvetica', 'normal');
      if (analysis.storage) {
        doc.text(
          `• Archivage du fichier : ${analysis.storage.location ?? analysis.storage.message ?? 'Information indisponible'}`,
          marginX,
          cursorY
        );
        cursorY += 14;
      }
      if (analysis.sheet) {
        doc.text(
          `• Google Sheets : ${analysis.sheet.message ?? (analysis.sheet.success ? 'Enregistré.' : 'Non enregistré.')}`,
          marginX,
          cursorY
        );
        cursorY += 14;
      }
      cursorY += 12;
    }

    if (collaboration) {
      if (cursorY > 660) {
        doc.addPage();
        cursorY = 72;
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text('Analyse collaboration humain–IA', marginX, cursorY);
      cursorY += 20;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(90, 99, 122);
      doc.text('Évaluation de la qualité du dialogue et de l’exploitation des suggestions IA.', marginX, cursorY);
      doc.setTextColor(33, 37, 41);
      cursorY += 18;

      const collabRows = Object.values(collaboration.scores || {}).map((value) => [
        value.label || '-',
        `${value.score.toFixed(1)}/5 (${Math.round(value.score * 20)}%)`,
        value.comment,
        value.example || '',
      ]);

      if (collabRows.length) {
        doc.autoTable({
          startY: cursorY,
          head: [['Critère', 'Score', 'Commentaire', 'Exemple']],
          body: collabRows,
          theme: 'striped',
          headStyles: { fillColor: [29, 42, 74], textColor: 255, fontStyle: 'bold' },
          styles: {
            fontSize: 10,
            cellPadding: 6,
            textColor: [33, 37, 41],
            lineColor: [226, 232, 240],
            lineWidth: 0.2,
            overflow: 'linebreak',
          },
          alternateRowStyles: { fillColor: [246, 248, 255] },
          columnStyles: {
            0: { cellWidth: 140 },
            1: { cellWidth: 90, halign: 'center' },
            2: { cellWidth: 170, overflow: 'linebreak', valign: 'top' },
            3: { cellWidth: 120, overflow: 'linebreak', valign: 'top' },
          },
        });
        cursorY = doc.lastAutoTable.finalY + 18;
      }

      const advice = collaboration.advice || {};
      const listSection = (title, items) => {
        if (!items || items.length === 0) {
          return;
        }
        if (cursorY > 720) {
          doc.addPage();
          cursorY = 72;
        }
        // Boîte de section pour lisibilité
        const boxX = marginX;
        const boxW = pageWidth - marginX * 2;
        doc.setFillColor(248, 251, 255);
        doc.setDrawColor(210, 224, 255);
        const boxStartY = cursorY;
        // Titre
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.text(title, boxX, cursorY + 16);
        cursorY += 32;
        doc.setFont('helvetica', 'normal');
        const maxWidth = boxW - 16;
        items.forEach((item) => {
          const lines = doc.splitTextToSize(`• ${item}`, maxWidth);
          doc.text(lines, boxX + 8, cursorY, { maxWidth });
          cursorY += lines.length * 12 + 4;
          if (cursorY > 760) {
            // Fermer la boîte et passer à la page suivante
            doc.roundedRect(boxX, boxStartY + 6, boxW, cursorY - boxStartY, 8, 8);
            doc.addPage();
            cursorY = 72;
          }
        });
        // Dessiner la boîte autour de la section
        doc.roundedRect(boxX, boxStartY + 6, boxW, cursorY - boxStartY, 8, 8);
        cursorY += 8;
      };

      listSection('Points forts', advice.strengths);
      listSection('Axes d’amélioration', advice.improvements);
      listSection('Conseils personnalisés', advice.tips);
    }

    // Module 3 — Législation
    if (legalResult) {
      if (cursorY > 660) {
        doc.addPage();
        cursorY = 72;
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text('Module 3 — Législation (recherche et interprétation)', marginX, cursorY);
      cursorY += 20;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(90, 99, 122);
      doc.text('Trois réponses libres évaluées sur la conformité de sens aux exigences réglementaires.', marginX, cursorY);
      doc.setTextColor(33, 37, 41);
      cursorY += 18;

      const legalRows = (legalResult.details || []).map((d) => [
        d.questionId,
        `${d.score}%`,
        d.comment
      ]);

      doc.autoTable({
        startY: cursorY,
        head: [['Question', 'Score', 'Commentaire']],
        body: legalRows,
        theme: 'striped',
        headStyles: { fillColor: [0, 118, 255], textColor: 255, fontStyle: 'bold' },
        styles: { fontSize: 10, cellPadding: 6, textColor: [33,37,41], lineColor: [226,232,240], lineWidth: 0.2, overflow: 'linebreak' },
        alternateRowStyles: { fillColor: [246, 249, 255] },
        columnStyles: {
          0: { cellWidth: 90 },
          1: { cellWidth: 60, halign: 'center' },
          2: { cellWidth: 350, overflow: 'linebreak', valign: 'top' }
        }
      });
      cursorY = doc.lastAutoTable.finalY + 18;
    }

    const safeName = participantLabel.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase() || 'participant';
    doc.save(`eval-cosep-${safeName}.pdf`);
  };

  const handleCollaborationSubmit = async (event) => {
    event.preventDefault();
    if (!analysis) {
      setCollabError("Merci de terminer l'analyse de l'extraction avant de passer à l'étape 2.");
      return;
    }
    if (!collabText.trim()) {
      setCollabError("Veuillez coller la conversation complète avec l'IA avant de lancer l'analyse.");
      return;
    }

    setCollabStatus('working');
    setCollabError('');

    try {
      const payload = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        transcript: collabText.trim(),
        extractionScore: analysis.score ?? 0,
        submittedAt: Date.now(),
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
    } catch (error) {
      console.error(error);
      setCollabStatus('error');
      setCollabError(error.message || "Analyse collaboration impossible pour le moment.");
    }
  };

  const handleCollabPaste = (event) => {
    const { clipboardData } = event;
    if (!clipboardData) {
      return;
    }

    const html = clipboardData.getData('text/html');
    if (!html) {
      return;
    }

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

      if (!text) {
        return;
      }

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

  const handleDownloadReport = () => {
    if (!analysis) {
      return;
    }
    const blob = new Blob([reportContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const safeName = participantLabel.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase() || 'participant';
    const filename = `rapport-eval-cosep-${safeName}.txt`;
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const modulesDone = (analysis ? 1 : 0) + (legalResult ? 1 : 0) + (collaboration ? 1 : 0);
  const progressPct = Math.round((modulesDone / 3) * 100);

  return (
    <div className="layout">
      <div className="progress-rail">
        <div className="progress-fill" style={{ height: `${progressPct}vh` }} />
      </div>
      <main className="page">
      <div className="card">
        <h1>EVAL COSEP — Extraction du cahier des charges</h1>
        <p>
          Cette interface simule le travail d’un coordinateur COSEP : analysez les documents fournis, extrayez
          toutes les informations nécessaires et déposez votre synthèse sous forme de fichier Excel. Le score est
          calculé automatiquement en comparaison avec la référence validée.
        </p>
      </div>

      {phase === 'identify' && (
        <div className="card">
          <h2 id="task-1">Identifiez-vous pour démarrer</h2>
          <p className="status">Le chronomètre commencera dès que vous accéderez aux documents.</p>
          <div className="form-row">
            <label>
              Prénom
              <input type="text" value={firstName} onChange={(event) => setFirstName(event.target.value)} />
            </label>
            <label>
              Nom
              <input type="text" value={lastName} onChange={(event) => setLastName(event.target.value)} />
            </label>
          </div>
          <button className="primary" type="button" onClick={handleStartMission} disabled={!canStartMission}>
            Accéder aux documents et démarrer le chrono
          </button>
        </div>
      )}

      {phase !== 'identify' && (
        <div className="card">
          <h2 id="task-2">Mission et documents</h2>
          <p>
            Vous disposez de 30 minutes à partir du téléchargement des documents. Ce délai peut être dépassé, mais
            il sera enregistré dans l’analyse finale.
          </p>
          <div className="timer">
            Temps écoulé : {formattedElapsed} {hasExceededTime ? '(hors délai)' : ''}
          </div>
          <div className="pad-top">
            <p>Documents disponibles :</p>
            <div className="links">
              {DOCUMENT_LINKS.map((doc) => (
                <div key={doc.label} className="link-item">
                  <a href={doc.href} target="_blank" rel="noreferrer">
                    {doc.label}
                  </a>
                  {doc.description && <span className="link-description">{doc.description}</span>}
                </div>
              ))}
            </div>
          </div>
          <p className="status pad-top">
            Préparez votre analyse dans votre propre tableur Excel. La restitution doit être exhaustive et vérifiable.
          </p>
          <p className="status note-lock">
            Cette session est verrouillée après démarrage. Veillez à finaliser votre extraction avant de déposer votre fichier.
          </p>
        </div>
      )}

      {phase !== 'identify' && (
        <div className="card">
          <h2 id="task-3">Déposez votre fichier Excel d’analyse</h2>
          <form onSubmit={handleSubmit}>
            <div className="upload-zone">
              <p>Glissez votre fichier Excel ici ou utilisez le sélecteur ci-dessous.</p>
              <input type="file" accept=".xls,.xlsx" onChange={handleFileChange} />
            </div>
            <p className="status">
              Formats acceptés : .xlsx et .xls. Le fichier est conservé à des fins d’audit et de traçabilité.
            </p>
            <button className="primary pad-top" type="submit" disabled={status === 'working'}>
              {status === 'working' ? 'Analyse en cours…' : 'Lancer l’analyse'}
            </button>
          </form>
          {errorMessage && <div className="error">{errorMessage}</div>}
        </div>
      )}

      {analysis && (
        <div className="card">
          <h2 id="task-4">Module 1 — Résultat de l’extraction</h2>
          <div className="results">
            <div className="results-header">
              <div>
                <p className="participant">{participantLabel || 'Participant'}</p>
                <p className="timestamp">
                  Soumis le{' '}
                  {analysis.elapsed?.submittedAt
                    ? new Date(analysis.elapsed.submittedAt).toLocaleString()
                    : new Date().toLocaleString()}
                </p>
              </div>
              <div
                className={`score-badge ${
                  analysis.score >= 80 ? 'score-good' : analysis.score >= 50 ? 'score-medium' : 'score-low'
                }`}
              >
                {analysis.score?.toFixed(1) ?? '0.0'}%
              </div>
            </div>
            <p className="elapsed">
              Temps enregistré : {analysis.elapsed?.formatted ?? formattedElapsed}{' '}
              {analysis.elapsed?.ms > THIRTY_MINUTES_MS ? '(hors délai)' : ''}
            </p>
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
            {analysis.storage && (
              <p className="status">
                Copie du fichier : {analysis.storage.location ?? analysis.storage.message ?? 'enregistrée.'}
              </p>
            )}
            {analysis.sheet && (
              <p className="status">
                Archivage Google Sheets : {analysis.sheet.message ?? (analysis.sheet.success ? 'Enregistré.' : 'Non enregistré.')}
              </p>
            )}
          </div>
          <button type="button" className="primary download" onClick={handleDownloadPdf}>
            Télécharger l’évaluation (PDF)
          </button>
        </div>
      )}

      {analysis && (
        <div className="card">
          <h2 id="task-5">Module 2 — Collaboration humain–IA</h2>
          <p>
            Collez ci-dessous l’intégralité de votre échange avec l’IA (ChatGPT, Gemini, etc.). Le système analyse la qualité de
            la collaboration et vous fournit un diagnostic critique.
          </p>
          <form onSubmit={handleCollaborationSubmit}>
            <textarea
              value={collabText}
              onChange={(event) => setCollabText(event.target.value)}
              onPaste={handleCollabPaste}
              placeholder="Collez ici votre conversation complète, dans l’ordre chronologique."
              rows={14}
            />
            <p className="status">
              Les informations sont traitées localement pour cette évaluation et ne sont pas partagées publiquement.
            </p>
            <button className="primary" type="submit" disabled={collabStatus === 'working'}>
              {collabStatus === 'working' ? 'Analyse de la collaboration…' : 'Analyser la collaboration'}
            </button>
          </form>
          {collabError && <div className="error">{collabError}</div>}

          {collaboration && (
            <div className="collab-results">
              <div className="collab-overview">
                <span className="collab-overall">
                  Score global collaboration : {collaboration.overall?.toFixed(1) ?? '0.0'}/5 ({Math.round((collaboration.overall ?? 0) * 20)}%)
                </span>
                {collaboration.storage && (
                  <span className="collab-status">
                    Archivage conversation : {collaboration.storage.location ?? collaboration.storage.message ?? 'n/a'}
                  </span>
                )}
                {collaboration.sheet && (
                  <span className="collab-status">
                    Google Sheets : {collaboration.sheet.message ?? (collaboration.sheet.success ? 'Enregistré.' : 'Non enregistré.')}
                  </span>
                )}
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
                    <span className="collab-score">{value.score.toFixed(1)}/5 ({Math.round(value.score * 20)}%)</span>
                    <span className="collab-comment">
                      {value.comment}
                      {value.example && <span className="collab-example">{value.example}</span>}
                    </span>
                  </div>
                ))}
              </div>

              <div className="collab-advice">
                {collaboration.advice?.strengths?.length ? (
                  <div>
                    <h3>Points forts</h3>
                    <ul>
                      {collaboration.advice.strengths.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {collaboration.advice?.improvements?.length ? (
                  <div>
                    <h3>Axes d’amélioration</h3>
                    <ul>
                      {collaboration.advice.improvements.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {collaboration.advice?.tips?.length ? (
                  <div>
                    <h3>Conseils personnalisés</h3>
                    <ul>
                      {collaboration.advice.tips.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </div>
          )}
          <button type="button" className="primary download" onClick={handleDownloadPdf}>Télécharger l’évaluation (PDF)</button>
        </div>
      )}

      {/* Module 3 — Législation */}
      {phase !== 'identify' && (
        <div className="card">
          <h2 id="task-6">Module 3 — Législation: formation sécurité (10 min)</h2>
          <div className="info-box">
            <h4>Contexte et consignes</h4>
            <p className="muted">
              Vous devez rechercher et interpréter correctement la réglementation relative à la formation de base en sécurité sur les
              chantiers temporaires ou mobiles (Arrêté royal du 7 avril 2023, secteur construction CP 124, CCT et attestations Constructiv/VCA).
              Utilisez une IA et le web si nécessaire. Vous avez 10 minutes pour répondre aux 3 questions ci‑dessous.
              L’évaluation porte sur l’exactitude du sens, pas sur les mots exacts.
            </p>
          </div>
          <div className="timer">Temps écoulé: {formatDuration(legalElapsed)} {legalStart ? '' : '(cliquez sur Démarrer)'} </div>
          <div className="pad-top">
            <button className="secondary" type="button" onClick={() => { setLegalStart(Date.now()); setLegalElapsed(0); }} disabled={!!legalStart}>
              Démarrer le module (10:00)
            </button>
          </div>
          <div className="pad-top">
            <label>
              Q1 — Objectif et champ d'application (AR 7 avril 2023)
              <span className="muted"> — But de la formation, risques couverts (propres et d’autres entrepreneurs), démontrabilité par l’entrepreneur.</span>
              <textarea rows={5} value={legalQ1} onChange={(e) => setLegalQ1(e.target.value)} placeholder="Votre réponse libre" />
            </label>
          </div>
          <div className="pad-top">
            <label>
              Q2 — Contenu et durée minimales (CP 124)
              <span className="muted"> — Durée minimale 8h; citez deux objectifs parmi acteurs, collaboration, principes généraux de prévention, mesures de prévention, comportement sûr.</span>
              <textarea rows={5} value={legalQ2} onChange={(e) => setLegalQ2(e.target.value)} placeholder="Votre réponse libre" />
            </label>
          </div>
          <div className="pad-top">
            <label>
              Q3 — Équivalences et dispenses (CCT + AR)
              <span className="muted"> — Citez au moins deux conditions valides (ex: VCA, 5 ans d’expérience selon AR/CCT, autre formation équivalente, attestation Constructiv, formation sécurité Constructiv).</span>
              <textarea rows={5} value={legalQ3} onChange={(e) => setLegalQ3(e.target.value)} placeholder="Votre réponse libre" />
            </label>
          </div>
          <div className="pad-top">
            <button className="primary" type="button" disabled={legalStatus==='working'} onClick={async () => {
              setLegalStatus('working'); setLegalError('');
              try {
                const payload = {
                  answers: { Q1: legalQ1, Q2: legalQ2, Q3: legalQ3 },
                  startedAt: legalStart,
                  submittedAt: Date.now(),
                  elapsedMs: legalStart ? Date.now() - legalStart : 0
                };
                const res = await fetch('/.netlify/functions/evaluate-legal-training', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                if (!res.ok) throw new Error(await res.text());
                const json = await res.json();
                setLegalResult(json);
                setLegalStatus('success');
              } catch (err) {
                setLegalError(err.message || 'Erreur pendant l\'évaluation.');
                setLegalStatus('error');
              }
            }}>
              {legalStatus==='working' ? 'Évaluation en cours…' : 'Soumettre le module'}
            </button>
          </div>
          {legalError && <div className="error">{legalError}</div>}

          {legalResult && (
            <div className="results pad-top">
              <div className="results-header">
                <div>
                  <p className="participant">Score module 3</p>
                  <p className="timestamp">{(legalResult.score ?? 0).toFixed(1)}%</p>
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
              <button type="button" className="primary download" onClick={handleDownloadPdf}>Télécharger l’évaluation (PDF)</button>
            </div>
          )}
        </div>
      )}
      </main>
    </div>
  );
}
