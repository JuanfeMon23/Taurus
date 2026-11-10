export default defineAppConfig({
  ui: {
    // Naranja/ámbar de Taurus (--accent en main.css) y gris azulado como neutro.
    colors: { primary: 'amber', neutral: 'slate' },
    button: {
      compoundVariants: [
        // Texto oscuro sobre el ámbar sólido (el blanco por defecto no alcanza contraste AA).
        { color: 'primary', variant: 'solid', class: 'text-[var(--accent-ink)] font-semibold' },
      ],
    },
  },
})
