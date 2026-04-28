function normalizeFieldType(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function getFieldOptions(component) {
  if (Array.isArray(component?.values)) {
    return component.values;
  }
  if (Array.isArray(component?.options)) {
    return component.options;
  }
  return [];
}

function collectSchemaFields(components, acc = []) {
  if (!Array.isArray(components)) {
    return acc;
  }
  components.forEach((component) => {
    if (!component || typeof component !== "object") {
      return;
    }
    const nested = Array.isArray(component.components) ? component.components : null;
    const type = normalizeFieldType(component.type);
    const key = String(component.key || "").trim();
    const supported = new Set(["textfield", "text", "textarea", "number", "checkbox", "radio", "select", "datetime", "date"]);
    if (key && type) {
      if (supported.has(type)) {
        acc.push({
          type,
          key,
          label: String(component.label || key).trim() || key,
          required: component.required === true,
          options: getFieldOptions(component),
        });
      } else {
        acc.push({
          type,
          key,
          label: String(component.label || key).trim() || key,
          required: component.required === true,
          unsupported: true,
        });
      }
    }
    if (nested) {
      collectSchemaFields(nested, acc);
    }
  });
  return acc;
}

export function extractCamundaFormFields(schema) {
  return collectSchemaFields(schema?.components || []);
}

function renderOptionLabel(option) {
  if (!option || typeof option !== "object") {
    return "";
  }
  return String(option.label || option.text || option.value || "").trim();
}

function renderOptionValue(option) {
  if (!option || typeof option !== "object") {
    return "";
  }
  return String(option.value ?? option.key ?? option.id ?? "");
}

export default function CamundaTaskFormRenderer({ schema, values, onChange, validationErrors = {} }) {
  const fields = extractCamundaFormFields(schema);
  if (!fields.length) {
    return (
      <p className="funcionario-expediente-detail__action-block-muted">
        El formulario de Camunda no contiene campos renderizables en esta V1.
      </p>
    );
  }
  return (
    <div className="funcionario-expediente-detail__guided-form funcionario-expediente-detail__guided-form--wide">
      {fields.map((field) => {
        const value = values?.[field.key];
        const error = validationErrors?.[field.key];
        if (field.unsupported) {
          return (
            <div key={field.key}>
              <p className="funcionario-expediente-detail__field-label">{field.label}</p>
              <p className="funcionario-expediente-detail__action-block-muted">
                Este campo no está soportado todavía en la V1.
              </p>
            </div>
          );
        }
        if (field.type === "textarea") {
          return (
            <div key={field.key}>
              <label className="funcionario-expediente-detail__field-label" htmlFor={`camunda-form-${field.key}`}>
                {field.label}
                {field.required ? " *" : ""}
              </label>
              <textarea
                id={`camunda-form-${field.key}`}
                className="funcionario-expediente-detail__textarea"
                rows={4}
                value={value == null ? "" : String(value)}
                onChange={(event) => onChange(field.key, event.target.value)}
              />
              {error ? <p className="error-message">{error}</p> : null}
            </div>
          );
        }
        if (field.type === "checkbox") {
          return (
            <div key={field.key}>
              <label className="funcionario-expediente-detail__field-label" htmlFor={`camunda-form-${field.key}`}>
                <input
                  id={`camunda-form-${field.key}`}
                  type="checkbox"
                  checked={Boolean(value)}
                  onChange={(event) => onChange(field.key, event.target.checked)}
                  style={{ marginRight: "0.5rem" }}
                />
                {field.label}
                {field.required ? " *" : ""}
              </label>
              {error ? <p className="error-message">{error}</p> : null}
            </div>
          );
        }
        if (field.type === "radio") {
          return (
            <fieldset key={field.key}>
              <legend className="funcionario-expediente-detail__field-label">
                {field.label}
                {field.required ? " *" : ""}
              </legend>
              {field.options.map((option, index) => {
                const optValue = renderOptionValue(option);
                const optLabel = renderOptionLabel(option) || `Opción ${index + 1}`;
                return (
                  <label key={`${field.key}-${index}`} className="small" style={{ display: "block" }}>
                    <input
                      type="radio"
                      name={`camunda-form-${field.key}`}
                      value={optValue}
                      checked={String(value ?? "") === optValue}
                      onChange={(event) => onChange(field.key, event.target.value)}
                      style={{ marginRight: "0.5rem" }}
                    />
                    {optLabel}
                  </label>
                );
              })}
              {error ? <p className="error-message">{error}</p> : null}
            </fieldset>
          );
        }
        if (field.type === "select") {
          return (
            <div key={field.key}>
              <label className="funcionario-expediente-detail__field-label" htmlFor={`camunda-form-${field.key}`}>
                {field.label}
                {field.required ? " *" : ""}
              </label>
              <select
                id={`camunda-form-${field.key}`}
                className="funcionario-expediente-detail__input"
                value={value == null ? "" : String(value)}
                onChange={(event) => onChange(field.key, event.target.value)}
              >
                <option value="">Seleccionar...</option>
                {field.options.map((option, index) => {
                  const optValue = renderOptionValue(option);
                  const optLabel = renderOptionLabel(option) || `Opción ${index + 1}`;
                  return (
                    <option key={`${field.key}-${index}`} value={optValue}>
                      {optLabel}
                    </option>
                  );
                })}
              </select>
              {error ? <p className="error-message">{error}</p> : null}
            </div>
          );
        }
        const inputType =
          field.type === "number"
            ? "number"
            : field.type === "datetime"
              ? "datetime-local"
              : field.type === "date"
                ? "date"
                : "text";
        return (
          <div key={field.key}>
            <label className="funcionario-expediente-detail__field-label" htmlFor={`camunda-form-${field.key}`}>
              {field.label}
              {field.required ? " *" : ""}
            </label>
            <input
              id={`camunda-form-${field.key}`}
              className="funcionario-expediente-detail__input"
              type={inputType}
              value={value == null ? "" : String(value)}
              onChange={(event) =>
                onChange(
                  field.key,
                  field.type === "number"
                    ? event.target.value === ""
                      ? ""
                      : Number(event.target.value)
                    : event.target.value
                )
              }
            />
            {error ? <p className="error-message">{error}</p> : null}
          </div>
        );
      })}
    </div>
  );
}
