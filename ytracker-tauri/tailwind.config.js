/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            keyframes: {
                shimmer: {
                    "0%": { backgroundPosition: "-200% 0" },
                    "100%": { backgroundPosition: "200% 0" },
                },
                fadeUp: {
                    "0%": { opacity: 0, transform: "translateY(16px) scale(0.97)" },
                    "100%": { opacity: 1, transform: "translateY(0) scale(1)" },
                },
                pop: {
                    "0%": { opacity: 0, transform: "scale(0.96)" },
                    "60%": { opacity: 1, transform: "scale(1.02)" },
                    "100%": { opacity: 1, transform: "scale(1)" },
                },
                halo: {
                    "0%": { opacity: 0.2, transform: "scale(0.8)" },
                    "50%": { opacity: 0.6, transform: "scale(1.05)" },
                    "100%": { opacity: 0, transform: "scale(1.3)" },
                },
            },
            animation: {
                shimmer: "shimmer 1.6s linear infinite",
                fadeUp: "fadeUp 0.22s ease forwards",
                pop: "pop 0.22s ease",
                halo: "halo 2.4s ease-out infinite",
            },
        },
    },
    plugins: [],
}
