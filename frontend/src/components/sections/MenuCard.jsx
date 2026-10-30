export default function MenuCard({ cardObject, clickableFnc }) {
    return (
        <div
            key={cardObject.key}
            {...clickableFnc}
            className="menu-card group bg-white rounded-3xl overflow-hidden shadow-xl hover:shadow-2xl transition-all duration-500 border border-gray-100 cursor-pointer transform hover:-translate-y-2 flex flex-col"
        >
            <div className="relative h-56 overflow-hidden bg-gray-100 flex-shrink-0">
                <img
                    src={cardObject.image}
                    alt={cardObject.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                />
                <div className="absolute top-4 left-4 bg-white text-[--green] px-3 py-1 rounded-full text-[13px] font-[700] uppercase shadow-xl">
                    {cardObject.badge}
                </div>
            </div>

            <div className="p-6 flex flex-col flex-1">
                <h3 className="menu-card-title gelasio text-gray-900 font-bold mt-2 mb-4">{cardObject.title}</h3>
                <p className="leading-relaxed font-light mb-4">{cardObject.description}</p>

                <div className="flex flex-wrap gap-2 mb-6">
                    {cardObject.tags.map(tag => (
                        <span key={tag} className="text-[13px] bg-gray-100 text-gray-600 px-3 py-1 rounded-full font-medium">{tag}</span>
                    ))}
                </div>

                <button className="mt-auto w-full py-3 rounded-full bg-gray-900 text-white font-bold text-sm uppercase tracking-wider hover:bg-brand-600 transition-all duration-300 shadow group-hover:shadow-lg">
                    {cardObject.cta}
                </button>
            </div>
        </div>
    )
}