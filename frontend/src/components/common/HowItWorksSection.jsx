import React from 'react';
import { HOW_IT_WORKS_STEPS } from '../../constants/homeConstants';

/**
 * @description Section "Comment ça marche" avec icônes et étapes
 */
const HowItWorksSection = () => {
  return (
    <section className="bg-[--green] text-white how-it-works">
      <div className="mx-auto px-2 xl:px-6">
        <div className="section-head">
          <span className="macchiato-light-title mb-2">Le Concept</span>
          <h2 className="section-title w-fit text-white">Comment ça marche ?</h2>
        </div>

        <div className="how-it-works-grid relative gradient-line-section">
          {HOW_IT_WORKS_STEPS.map((step, idx) => (
            <div key={idx} className="hit-step-block group relative z-[10]">
              <div className="hit-step gelasio font-bold">
                {step.icon}
              </div>
              <h3 className="hit-title font-[500] mb-1 text-[--macchiatoLight]">{step.title}</h3>
              <p className="hit-text font-[300] text-white px-2 leading-relaxed">{step.text}</p>
              <div className="illustration-icons flex">
                {step.illustrations.map((icon, iid) => (
                  <img src={icon.url} key={iid} alt="" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorksSection;