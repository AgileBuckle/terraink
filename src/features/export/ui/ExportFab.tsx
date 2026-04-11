import { useEffect, useState } from "react";
import { useExport } from "@/features/export/application/useExport";
import type { ExportFormat } from "@/features/export/domain/types";
import { CloseIcon, DownloadIcon, LoaderIcon } from "@/shared/ui/Icons";
import SupportModal from "@/features/export/ui/SupportModal";
import SocialLinkGroup from "@/shared/ui/SocialLinkGroup";

interface ExportFabProps {
  isMobile: boolean;
}

export default function ExportFab({ isMobile }: ExportFabProps) {
  const {
    isExporting,
    handleDownloadPng,
    handleDownloadPdf,
    handleDownloadSvg,
    supportPrompt,
    dismissSupportPrompt,
  } = useExport();
  const [isOpen, setIsOpen] = useState(false);
  const [activeFormat, setActiveFormat] = useState<ExportFormat | null>(null);
  const [isTriggerVisible, setIsTriggerVisible] = useState(true);

  useEffect(() => {
    if (!isExporting && activeFormat) {
      setActiveFormat(null);
      setIsOpen(false);
    }
  }, [isExporting, activeFormat]);

  useEffect(() => {
    if (!isMobile) return;

    const FOOTER_OVERLAP_THRESHOLD_PX = 140;

    const updateVisibility = () => {
      const doc = document.documentElement;
      const scrolledToBottom =
        window.scrollY + window.innerHeight >=
        doc.scrollHeight - FOOTER_OVERLAP_THRESHOLD_PX;
      setIsTriggerVisible(!scrolledToBottom);
    };

    updateVisibility();
    window.addEventListener("scroll", updateVisibility, { passive: true });
    window.addEventListener("resize", updateVisibility);
    return () => {
      window.removeEventListener("scroll", updateVisibility);
      window.removeEventListener("resize", updateVisibility);
    };
  }, [isMobile]);

  const runExport = (format: ExportFormat) => {
    setActiveFormat(format);
    if (format === "png") {
      void handleDownloadPng();
      return;
    }
    if (format === "pdf") {
      void handleDownloadPdf();
      return;
    }
    void handleDownloadSvg();
  };

  const isLoading = (format: ExportFormat) =>
    isExporting && activeFormat === format;

  const triggerClass = isMobile
    ? `mobile-export-fab-trigger${isTriggerVisible ? "" : " is-hidden"}`
    : "export-fab-trigger-desktop";

  return (
    <>
      <button
        type="button"
        className={triggerClass}
        aria-label="Export poster"
        title="Export poster"
        onClick={() => setIsOpen(true)}
        tabIndex={isMobile && !isTriggerVisible ? -1 : 0}
        aria-hidden={isMobile && !isTriggerVisible}
      >
        <DownloadIcon />
        {!isMobile && <span>Download</span>}
      </button>

      {isOpen ? (
        <div
          className="export-modal-backdrop"
          role="presentation"
          onClick={() => !isExporting && setIsOpen(false)}
        >
          <div
            className="export-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="export-modal-header">
              <h3 id="export-modal-title">Download Poster</h3>
              <button
                type="button"
                className="export-modal-close"
                onClick={() => !isExporting && setIsOpen(false)}
                aria-label="Close export options"
              >
                <CloseIcon />
              </button>
            </div>
            <div className="export-modal-actions">
              <button
                type="button"
                className="export-modal-option export-modal-option--png"
                onClick={() => runExport("png")}
                disabled={isExporting}
              >
                {isLoading("png") ? (
                  <LoaderIcon className="export-modal-option-icon is-spinning" />
                ) : (
                  <DownloadIcon className="export-modal-option-icon" />
                )}
                <span>PNG</span>
              </button>
              <button
                type="button"
                className="export-modal-option export-modal-option--pdf"
                onClick={() => runExport("pdf")}
                disabled={isExporting}
              >
                {isLoading("pdf") ? (
                  <LoaderIcon className="export-modal-option-icon is-spinning" />
                ) : (
                  <DownloadIcon className="export-modal-option-icon" />
                )}
                <span>PDF</span>
              </button>
              <button
                type="button"
                className="export-modal-option export-modal-option--svg"
                onClick={() => runExport("svg")}
                disabled={isExporting}
              >
                {isLoading("svg") ? (
                  <LoaderIcon className="export-modal-option-icon is-spinning" />
                ) : (
                  <DownloadIcon className="export-modal-option-icon" />
                )}
                <span>SVG</span>
              </button>
            </div>
            <p className="export-modal-support-label">
              Support the project <span className="heart">❤︎</span>
            </p>
            <SocialLinkGroup variant="mobile-export" />
          </div>
        </div>
      ) : null}

      {supportPrompt ? (
        <SupportModal
          posterNumber={supportPrompt.posterNumber}
          onClose={dismissSupportPrompt}
          titleId="export-fab-support-modal-title"
        />
      ) : null}
    </>
  );
}
