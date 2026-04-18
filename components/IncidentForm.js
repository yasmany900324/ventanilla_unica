"use client";

import { useState } from "react";
import { useLocale } from "./LocaleProvider";
import { getLocaleCopy } from "../lib/uiTranslations";

const INITIAL_FORM_STATE = {
  category: "",
  description: "",
  location: "",
};

export default function IncidentForm({
  onSubmit,
  submitLabel = "Enviar solicitud",
}) {
  const { locale } = useLocale();
  const copy = getLocaleCopy(locale);
  const formCopy = copy.incidentForm;
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
          throw new Error(result.message || formCopy.submitError);
        }
        setFormData(INITIAL_FORM_STATE);
      })
      .catch((error) => {
        setSubmitError(error.message || formCopy.submitError);
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  };

  return (
    <form className="incident-form" onSubmit={handleSubmit}>
      <label>
        {formCopy.categoryLabel}
        <select
          name="category"
          value={formData.category}
          onChange={handleChange}
          required
        >
          <option value="">{formCopy.selectCategory}</option>
          <option value="alumbrado">{formCopy.categories.alumbrado}</option>
          <option value="limpieza">{formCopy.categories.limpieza}</option>
          <option value="seguridad">{formCopy.categories.seguridad}</option>
          <option value="infraestructura">{formCopy.categories.infraestructura}</option>
          <option value="otro">{formCopy.categories.otro}</option>
        </select>
      </label>

      <label>
        {formCopy.descriptionLabel}
        <textarea
          name="description"
          value={formData.description}
          onChange={handleChange}
          placeholder={formCopy.descriptionPlaceholder}
          required
          rows={4}
        />
      </label>

      <label>
        {formCopy.locationLabel}
        <input
          type="text"
          name="location"
          value={formData.location}
          onChange={handleChange}
          placeholder={formCopy.locationPlaceholder}
          required
        />
      </label>

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? formCopy.submitting : submitLabel || formCopy.defaultSubmitLabel}
      </button>
      {submitError ? <p className="error-message">{submitError}</p> : null}
    </form>
  );
}
