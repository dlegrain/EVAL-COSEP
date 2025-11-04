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

  useEffect(() => {
    if (!startTime) {
      return;
    }

    const intervalId = setInterval(() => {
      setElapsedMs(Date.now() - startTime);
    }, 1000);

    return () => clearInterval(intervalId);
  }, [startTime]);

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
    const marginX = 48;
    let cursorY = 60;

    doc.setFontSize(18);
    doc.text('Rapport d’évaluation EVAL COSEP', marginX, cursorY);
    cursorY += 28;

    doc.setFontSize(12);
    doc.text(`Participant : ${participantLabel || 'Non renseigné'}`, marginX, cursorY);
    cursorY += 18;
    doc.text(
      `Soumission : ${
        analysis.elapsed?.submittedAt ? new Date(analysis.elapsed.submittedAt).toLocaleString() : new Date().toLocaleString()
      }`,
      marginX,
      cursorY
    );
    cursorY += 18;
    doc.text(`Score global : ${(analysis.score ?? 0).toFixed(1)} %`, marginX, cursorY);
    cursorY += 18;
    doc.text(`Temps écoulé : ${analysis.elapsed?.formatted ?? formattedElapsed}`, marginX, cursorY);
    cursorY += 28;

    const details = analysis.details?.length
      ? analysis.details.map((detail) => [
          detail.section,
          detail.score !== undefined ? `${detail.score}%` : 'N/A',
          detail.message,
        ])
      : [['Toutes les sections attendues', '100%', 'Aucun écart détecté']];

    doc.autoTable({
      startY: cursorY,
      head: [['Section', 'Score', 'Commentaire']],
      body: details,
      headStyles: { fillColor: [0, 88, 255], textColor: 255 },
      styles: { fontSize: 10, cellPadding: 6 },
      columnStyles: {
        0: { cellWidth: 200 },
        1: { cellWidth: 70, halign: 'center' },
        2: { cellWidth: 230 },
      },
    });

    cursorY = doc.lastAutoTable.finalY + 20;

    if (analysis.storage || analysis.sheet) {
      doc.setFontSize(12);
      doc.text('Traçabilité :', marginX, cursorY);
      cursorY += 16;
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
          `• Archivage Google Sheets : ${
            analysis.sheet.message ?? (analysis.sheet.success ? 'Enregistré.' : 'Non enregistré.')
          }`,
          marginX,
          cursorY
        );
        cursorY += 14;
      }
      cursorY += 10;
    }

    if (collaboration) {
      if (cursorY > 620) {
        doc.addPage();
        cursorY = 60;
      }

      doc.setFontSize(16);
      doc.text('Analyse collaboration humain–IA', marginX, cursorY);
      cursorY += 24;

      const collabRows = Object.entries(collaboration.scores || {}).map(([key, value]) => [
        key,
        `${value.score.toFixed(1)}/5`,
        value.comment,
      ]);

      if (collabRows.length) {
        doc.autoTable({
          startY: cursorY,
          head: [['Critère', 'Score', 'Commentaire']],
          body: collabRows,
          headStyles: { fillColor: [29, 42, 74], textColor: 255 },
          styles: { fontSize: 10, cellPadding: 6 },
          columnStyles: {
            0: { cellWidth: 160 },
            1: { cellWidth: 70, halign: 'center' },
            2: { cellWidth: 260 },
          },
        });
        cursorY = doc.lastAutoTable.finalY + 20;
      }

      const advice = collaboration.advice || {};
      const listSection = (title, items) => {
        if (!items || items.length === 0) {
          return;
        }
        if (cursorY > 720) {
          doc.addPage();
          cursorY = 60;
        }
        doc.setFontSize(12);
        doc.text(title, marginX, cursorY);
        cursorY += 16;
        items.forEach((item) => {
          doc.text(`• ${item}`, marginX, cursorY);
          cursorY += 14;
        });
        cursorY += 12;
      };

      listSection('Points forts', advice.strengths);
      listSection('Axes d’amélioration', advice.improvements);
      listSection('Recommandations', advice.tips);
    }

    const safeName = participantLabel.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase() || 'participant';
    doc.save(`rapport-eval-cosep-${safeName}.pdf`);
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

  return (
    <div className="page">
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
          <h2>1. Identifiez-vous pour démarrer</h2>
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
          <h2>2. Mission et documents</h2>
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
          <h2>3. Déposez votre fichier Excel d’analyse</h2>
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
          <h2>4. Résultat de l’analyse</h2>
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
            <button type="button" className="primary download" onClick={handleDownloadPdf}>
              Télécharger le rapport PDF
            </button>
          </div>
        </div>
      )}

      {analysis && (
        <div className="card">
          <h2>5. Analyse de la collaboration humain–IA</h2>
          <p>
            Collez ci-dessous l’intégralité de votre échange avec l’IA (ChatGPT, Gemini, etc.). Le système analyse la qualité de
            la collaboration et vous fournit un diagnostic critique.
          </p>
          <form onSubmit={handleCollaborationSubmit}>
            <textarea
              value={collabText}
              onChange={(event) => setCollabText(event.target.value)}
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
                  Score global collaboration : {collaboration.overall?.toFixed(1) ?? '0.0'}/5
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
                  <span>Score /5</span>
                  <span>Commentaire</span>
                </div>
                {Object.entries(collaboration.scores || {}).map(([key, value]) => (
                  <div key={key} className="collab-row">
                    <span className="collab-criterion">{value.label || key}</span>
                    <span className="collab-score">{value.score.toFixed(1)}</span>
                    <span className="collab-comment">{value.comment}</span>
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
        </div>
      )}
    </div>
  );
}
