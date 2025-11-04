import { useEffect, useMemo, useState } from 'react';

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
    description: 'Ajoutez le plan ici lorsque disponible.',
    pending: true,
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

  const canStartMission = firstName.trim().length > 0 && lastName.trim().length > 0;

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

  const handleReset = () => {
    localStorage.removeItem(STORAGE_KEYS.startTime);
    localStorage.setItem(STORAGE_KEYS.phase, 'identify');
    setStartTime(null);
    setElapsedMs(0);
    setPhase('identify');
    setAnalysis(null);
    setStatus('idle');
    setErrorMessage('');
    setFile(null);
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
                <a
                  key={doc.label}
                  href={doc.href}
                  target="_blank"
                  rel="noreferrer"
                  aria-disabled={doc.pending}
                  onClick={(event) => {
                    if (doc.pending) {
                      event.preventDefault();
                    }
                  }}
                >
                  {doc.label}
                  {doc.pending ? ' — à compléter' : ''}
                </a>
              ))}
            </div>
          </div>
          <p className="status pad-top">
            Préparez votre analyse dans votre propre tableur Excel. La restitution doit être exhaustive et vérifiable.
          </p>
          <button className="secondary pad-top" type="button" onClick={handleReset}>
            Réinitialiser la session
          </button>
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
            <p>
              Score de conformité : <strong>{analysis.score?.toFixed(1) ?? '0.0'}%</strong>
            </p>
            <p>Temps enregistré : {analysis.elapsed?.formatted ?? formattedElapsed}</p>
            {analysis.details?.length ? (
              <>
                <h3>Détails</h3>
                <ul>
                  {analysis.details.map((detail) => (
                    <li key={detail.section}>
                      <strong>{detail.section} :</strong> {detail.message}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>Toutes les sections attendues ont été retrouvées.</p>
            )}
            {analysis.storage && (
              <p className="status">
                Copie du fichier : {analysis.storage.location ?? analysis.storage.message ?? 'enregistrée.'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
