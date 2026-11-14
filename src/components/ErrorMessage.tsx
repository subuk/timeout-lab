import { DiagnosticError } from "../errors";
import { t } from "../locale";

export function ErrorMessage({ error }: { error: Error | string }) {
  return (
    <>
      <p>{t(error instanceof Error ? error.message : error)}</p>
      {error instanceof DiagnosticError && (
        <div className="error-details">
          <strong>{t("Technical details")}</strong>
          <pre>{error.details}</pre>
        </div>
      )}
    </>
  );
}
