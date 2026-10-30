export default function HeroCard({ backgroundImg, yellowLabel, sectionLabel, buttonLabel, action }) {
    return (
        <div className="relative w-full flex-1 group overflow-hidden">
            <div
                className="absolute inset-0 transition-transform duration-[2s] ease-in-out group-hover:scale-110"
                style={{ background: `linear-gradient(#00000020, #00000020), center / cover url(${backgroundImg})` }}
            />
            <div className="absolute inset-0 bg-black/40 group-hover:bg-black/30 transition-colors duration-500"></div>

            <div className="absolute inset-0 flex flex-col justify-center items-center text-white min-[576px]:px-6 md:px-8">
                <span className="text-sm uppercase mb-4 hero-subsection-label">{yellowLabel}</span>
                <h2 className="hero-subsection-title font-bold mb-6 text-center text-white drop-shadow-lg gelasio">{sectionLabel}</h2>
                <button
                    onClick={action}
                    className="heroBtn bg-white px-5 md:px-8 py-3 rounded-[30px] uppercase hover:bg-brand-600 hover:text-white transition-all duration-300"
                >
                    {buttonLabel}
                </button>
            </div>
        </div>
    )
}
