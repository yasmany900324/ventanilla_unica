"use client";

import { useState } from "react";

const INITIAL_FORM_STATE = {
  category: "",
  description: "",
  location: "",
};

export default function IncidentForm({ onSubmit }) {
  const [formData, setFormData] = useState(INITIAL_FORM_STATE);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    onSubmit(formData);
    setFormData(INITIAL_FORM_STATE);
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
          placeholder="Describe la incidencia"
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

      <button type="submit">Enviar incidencia</button>
    </form>
  );
}
