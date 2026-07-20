import { useState } from 'react';
import { Download, ShieldAlert, X } from './Icons';
import { useUpdateStore, type AvailableUpdate } from '../stores/updateStore';
import { getUpdatePresentation } from '../stores/updatePresentation';
import './UpdateBanner.css';

function ReleaseNotes({ update, onClose }: { update: AvailableUpdate; onClose: () => void }) {
  const sections = [
    ['Highlights', update.releaseNotes.highlights],
    ['Improvements and fixes', update.releaseNotes.fixes],
    ['Security', update.releaseNotes.security],
  ] as const;
  return (
    <div className="update-notes-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="update-notes" role="dialog" aria-modal="true" aria-labelledby="update-notes-title" onMouseDown={event => event.stopPropagation()}>
        <header className="update-notes__header">
          <div>
            <span className="update-notes__version">RIDGELINE {update.version}</span>
            <h2 id="update-notes-title">{update.releaseNotes.title}</h2>
            <time dateTime={update.publishedAt}>{new Date(update.publishedAt).toLocaleDateString()}</time>
          </div>
          <button className="update-icon-button" onClick={onClose} aria-label="Close release notes"><X size={18} /></button>
        </header>
        <p className="update-notes__summary">{update.releaseNotes.summary}</p>
        {sections.map(([title, items]) => items.length > 0 && (
          <div className="update-notes__section" key={title}>
            <h3>{title}</h3>
            <ul>{items.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}</ul>
          </div>
        ))}
      </section>
    </div>
  );
}

export function UpdateBanner() {
  const { snapshot, pendingMajorNotes, restartAndInstall, defer, markMajorNotesSeen, recordNotesOpened } = useUpdateStore();
  const [notes, setNotes] = useState<AvailableUpdate | null>(null);
  const available = snapshot.available;
  const presentation = getUpdatePresentation(snapshot, pendingMajorNotes);
  const isMajorReady = presentation === 'major-ready';
  const isMandatory = presentation === 'mandatory';
  const isRoutineStaged = presentation === 'routine-staged';

  const openInstalledNotes = () => {
    if (!pendingMajorNotes) return;
    setNotes(pendingMajorNotes);
    recordNotesOpened(pendingMajorNotes.version);
    void markMajorNotesSeen(pendingMajorNotes.version);
  };

  return (
    <>
      {pendingMajorNotes && (
        <div className="update-banner update-banner--major-installed" role="status">
          <Download size={16} />
          <strong>Ridgeline {pendingMajorNotes.version} is here</strong>
          <button className="update-banner__link" onClick={openInstalledNotes}>See what is new</button>
          <button className="update-icon-button" onClick={() => void markMajorNotesSeen(pendingMajorNotes.version)} aria-label="Dismiss update announcement"><X size={16} /></button>
        </div>
      )}

      {(isMajorReady || isMandatory) && available && (
        <div className={`update-banner ${isMandatory ? 'update-banner--mandatory' : 'update-banner--major'}`} role={isMandatory ? 'alert' : 'status'}>
          {isMandatory ? <ShieldAlert size={17} /> : <Download size={17} />}
          <div className="update-banner__copy">
            <strong>{isMandatory ? 'A security update is required' : `Ridgeline ${available.version} is ready`}</strong>
            <span>{isMandatory ? 'Update to continue using Ridgeline safely.' : available.releaseNotes.summary}</span>
            {snapshot.restartBlockedReason && <span className="update-banner__blocked">{snapshot.restartBlockedReason}</span>}
          </div>
          <div className="update-banner__actions">
            <button className="update-banner__button update-banner__button--quiet" onClick={() => { setNotes(available); recordNotesOpened(available.version); }}>What is New</button>
            {!isMandatory && <button className="update-banner__button update-banner__button--quiet" onClick={() => void defer()}>Later</button>}
            <button className="update-banner__button update-banner__button--primary" onClick={() => void restartAndInstall()}>Restart and Update</button>
          </div>
        </div>
      )}

      {isRoutineStaged && available && (
        <div className="update-toast" role="status">
          <Download size={15} />
          <span>Ridgeline {available.version} will install when you restart.</span>
          <button onClick={() => void restartAndInstall()}>Restart now</button>
        </div>
      )}

      {notes && <ReleaseNotes update={notes} onClose={() => setNotes(null)} />}
    </>
  );
}
