import { Plus } from './Icons';
import './CustomStatusBubble.css';

interface CustomStatusBubbleProps {
  status?: string | null;
  onClick?: () => void;
  compact?: boolean;
  className?: string;
}

export function CustomStatusBubble({
  status,
  onClick,
  compact = false,
  className = '',
}: CustomStatusBubbleProps) {
  const hasStatus = Boolean(status?.trim());
  const content = (
    <>
      {!hasStatus && <span className="custom-status-bubble__plus"><Plus size={13} /></span>}
      <span className={hasStatus ? 'custom-status-bubble__text' : 'custom-status-bubble__placeholder'}>
        {hasStatus ? status : 'What\'s your hot take?'}
      </span>
    </>
  );

  const classes = `custom-status-bubble${compact ? ' custom-status-bubble--compact' : ''} ${className}`.trim();
  if (!onClick) return <div className={classes}>{content}</div>;

  return (
    <button type="button" className={classes} onClick={onClick} aria-label="Edit custom status">
      {content}
    </button>
  );
}
