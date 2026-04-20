import { useMobileAccessStatus } from "../useMobileAccessStatus";
import { NotInstalledPane } from "./NotInstalledPane";
import { NotLoggedInPane } from "./NotLoggedInPane";
import { OffPane } from "./OffPane";
import { OnPane } from "./OnPane";
import { ErrorPane } from "./ErrorPane";

export function MobileAccessModal({ onClose }: { onClose: () => void }) {
  const { status, refresh, enable, disable } = useMobileAccessStatus(true);

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-surface text-foreground rounded-xl w-[28rem] max-h-[80vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {!status && <div className="p-4 text-sm opacity-60">Loading…</div>}
        {status?.state === "not_installed" && (
          <NotInstalledPane onRefresh={refresh} />
        )}
        {status?.state === "not_logged_in" && (
          <NotLoggedInPane onRefresh={refresh} />
        )}
        {status?.state === "off" && <OffPane onEnable={enable} />}
        {status?.state === "on" && (
          <OnPane status={status} onDisable={disable} onRegenerate={enable} />
        )}
        {status?.state === "error" && (
          <ErrorPane error={status.error} hint={status.hint} />
        )}
      </div>
    </div>
  );
}
