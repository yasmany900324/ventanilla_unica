/**
 * Zona de peligro — eliminación del expediente.
 */
export default function DangerZoneCard({ onRequestDelete, deleteLoading }) {
  return (
    <section className="dashboard-onify-card dashboard-onify-section funcionario-expediente-detail__card funcionario-expediente-detail__danger">
      <div className="dashboard-onify-section__head dashboard-onify-section__head--stacked">
        <div>
          <h2>Zona de peligro</h2>
          <p>Esta acción es irreversible. El expediente se elimina de forma permanente.</p>
        </div>
      </div>
      <button
        type="button"
        className="funcionario-expediente-detail__danger-btn"
        onClick={onRequestDelete}
        disabled={deleteLoading}
      >
        {deleteLoading ? "Eliminando…" : "Eliminar expediente"}
      </button>
    </section>
  );
}
