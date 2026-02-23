/**
 * RiskBanner — displayed when the security check detects elevated risk.
 * Shows a color-coded banner based on risk level.
 */

type RiskLevel = "low" | "medium" | "high" | "critical";

interface Props {
  riskLevel: RiskLevel;
  recommendedMode: string;
  signalCount: number;
  onViewDetails?: () => void;
}

const RISK_STYLES: Record<RiskLevel, { bg: string; border: string; text: string; icon: string }> = {
  low: {
    bg: "bg-green-900/30",
    border: "border-green-600",
    text: "text-green-300",
    icon: "✓",
  },
  medium: {
    bg: "bg-yellow-900/30",
    border: "border-yellow-600",
    text: "text-yellow-300",
    icon: "⚠",
  },
  high: {
    bg: "bg-orange-900/30",
    border: "border-orange-600",
    text: "text-orange-300",
    icon: "⚠",
  },
  critical: {
    bg: "bg-red-900/30",
    border: "border-red-600",
    text: "text-red-300",
    icon: "🛑",
  },
};

const RISK_LABELS: Record<RiskLevel, string> = {
  low: "Environment looks safe",
  medium: "Some concerns detected",
  high: "Elevated risk — High-Security mode recommended",
  critical: "Critical risk detected — enable maximum protections",
};

export default function RiskBanner({
  riskLevel,
  recommendedMode,
  signalCount,
  onViewDetails,
}: Props) {
  const style = RISK_STYLES[riskLevel];

  if (riskLevel === "low") return null; // Don't show banner for low risk

  return (
    <div
      className={`${style.bg} ${style.border} border-l-4 px-4 py-2 flex items-center gap-3`}
    >
      <span className="text-lg">{style.icon}</span>
      <div className="flex-1">
        <p className={`font-semibold text-sm ${style.text}`}>
          {RISK_LABELS[riskLevel]}
        </p>
        <p className="text-xs text-gray-400">
          {signalCount} risk signal{signalCount !== 1 ? "s" : ""} detected
          {recommendedMode !== "standard" &&
            ` — recommended: ${recommendedMode} mode`}
        </p>
      </div>
      {onViewDetails && (
        <button
          onClick={onViewDetails}
          className="text-xs text-indigo-400 hover:text-indigo-300 underline"
        >
          View Details
        </button>
      )}
    </div>
  );
}
