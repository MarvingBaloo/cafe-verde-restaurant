import React from 'react';
import { TESTIMONIALS } from '../../constants/homeConstants';
import woodBg from '../../assets/images/wood-wall.webp'
import quoteStart from '../../assets/svg/quote-start.svg'
import quoteEnd from '../../assets/svg/quote-end.svg'

/**
 * @description Section témoignages (preuve sociale)
 */
const TestimonialsSection = () => {
  return (
    <section className="bg-brand-50 testimonials"
      style={{ background: `center / cover no-repeat url(${woodBg})` }}>
      <div className="container mx-auto px-6">
        <h2 className="gelasio text-white testimonials-title">
          <p className='mb-4'>Ils ont goûté,</p>
          <p className=''>ils ont adoré</p>
        </h2>
        <div className="testimonials-grid">
          {TESTIMONIALS.map((avis, i) => (
            <div key={i} className="testimonial-card rounded-xl relative">
              <img src={quoteStart} alt="" className='quote-start' />
              <p className="relative z-10 h-[3lh]">{avis.text}</p>
              <img src={quoteEnd} alt="" className='quote-end ml-auto mb-6 ' />
              <p className="text-white not-italic">- {avis.name}</p>
            </div>
          ))}
        </div>
      </div>
    </section >
  );
};

export default TestimonialsSection;