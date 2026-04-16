"use client";

import { useState } from "react";

const INITIAL_FORM_STATE = {
  category: "",
  description: "",
  location: "",
};

export default function IncidentForm({
  onSubmit,
  submitLabel = "Enviar solicitud",
}) {
  const [formData, setFormData] = useState(INITIAL_FORM_STATE);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    setSubmitError("");
    setIsSubmitting(true);

    Promise.resolve(onSubmit(formData))
      .then((result) => {
        if (result && result.ok === false) {
          throw new Error(result.message || "No se pudo enviar la solicitud.");
        }
        setFormData(INITIAL_FORM_STATE);
      })
      .catch((error) => {
        setSubmitError(error.message || "No se pudo enviar la solicitud.");
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  };

  return (
    <form className="incident-form" onSubmit={handleSubmit}>
      <label>
        Categoría
        <select
          name="category"
          value={formData.category}
          onChange={handleChange}
          required
        >
          <option value="">Selecciona una categoría</option>
          <option value="alumbrado">Alumbrado</option>
          <option value="limpieza">Limpieza</option>
          <option value="seguridad">Seguridad</option>
          <option value="infraestructura">Infraestructura</option>
          <option value="otro">Otro</option>
        </select>
      </label>

      <label>
        Descripción
        <textarea
          name="description"
          value={formData.description}
          onChange={handleChange}
          placeholder="Describe la solicitud, reclamo o incidencia"
          required
          rows={4}
        />
      </label>

      <label>
        Ubicación
        <input
          type="text"
          name="location"
          value={formData.location}
          onChange={handleChange}
          placeholder="Ej. Calle 10 con Av. Principal"
          required
        />
      </label>

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Enviando..." : submitLabel}
      </button>
      {submitError ? <p className="error-message">{submitError}</p> : null}
    </form>
  );
}
