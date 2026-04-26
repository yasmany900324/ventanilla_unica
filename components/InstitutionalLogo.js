import Image from "next/image";

const LOGO_DIMENSIONS = {
  width: 1401,
  height: 606,
};

const VARIANT_SIZES = {
  header: "(max-width: 640px) 42vw, (max-width: 960px) 22vw, 174px",
  footer: "(max-width: 640px) 64vw, (max-width: 960px) 40vw, 300px",
};

export default function InstitutionalLogo({ alt, variant = "header", priority = false }) {
  const safeVariant = variant === "footer" ? "footer" : "header";
  const imageSrc =
    safeVariant === "footer"
      ? "/images/logo-intendencia-maldonado-footer.png"
      : "/images/logo-intendencia-maldonado.png";

  return (
    <span className={`institutional-logo institutional-logo--${safeVariant}`}>
      <Image
        src={imageSrc}
        alt={alt}
        width={LOGO_DIMENSIONS.width}
        height={LOGO_DIMENSIONS.height}
        sizes={VARIANT_SIZES[safeVariant]}
        priority={priority}
        className="institutional-logo__image"
      />
    </span>
  );
}
