import cosy from '../../assets/images/cosy.webp'

export default function Atmosphere() {
    return (
        <section className='atmosphere-section'
            style={{ background: `center / cover url(${cosy})` }}
        >
            <div className="section-head flex flex-col-reverse">
                <h2 className="section-title mb-8 w-[10ch] ml-auto text-right">Un endroit convivial</h2>
                <h3 className="macchiato-title mb-2 text-right">Le café verde c'est aussi</h3>
            </div>
            <p className='text-white macchiato80 p-6 rounded-[4px] atmosphere-text'>
                Le Café Verde vous accueille dans une ambiance chaleureuse pour une pause gourmande et équilibrée.
                <br /><br />Installez-vous confortablement, profitez d'un moment agréable, seul ou accompagné.
            </p>
        </section >
    )
}