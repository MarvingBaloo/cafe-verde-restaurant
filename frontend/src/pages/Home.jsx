// src/pages/Home.jsx
import React from 'react';
import { useNavigate } from 'react-router-dom';

// Import des sections modulaires
import HeroSection from '../components/sections/HeroSection';
import FloatingMoodButton from '../components/FloatingMoodButton';
import ManifestoSection from '../components/sections/ManifestoSection';
import HowItWorksSection from '../components/common/HowItWorksSection';
import MenuPresentation from '../components/sections/MenuPresentation';
import Atmosphere from '../components/sections/Atmosphere';
import TestimonialsSection from '../components/sections/TestimonialsSection';
import CallToActionSection from '../components/sections/CallToActionSection';

const Home = () => {
  const navigate = useNavigate();


  const handleSaladClick = () => {
    navigate('/products', { state: { category: 'salad' } });
  };

  const handleHotDishClick = () => {
    navigate('/products', { state: { category: 'hot_dish' } });
  };

  const handleDrinksClick = () => {
    navigate('/products', { state: { category: 'drinks' } });
  };

  const handleDessertsClick = () => {
    navigate('/products', { state: { category: 'desserts' } });
  };

  const handleStartOrder = () => {
    document.getElementById('menu').scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-white text-gray-900 selection:bg-brand-200 selection:text-brand-900">
      {/* 1. SPLIT HERO */}
      <HeroSection
        onSaladClick={handleSaladClick}
        onHotDishClick={handleHotDishClick}
        onDrinksClick={handleDrinksClick}
        onDessertsClick={handleDessertsClick}
      />

      {/* 2. BOUTON FLOTTANT MOOD FOOD */}
      <FloatingMoodButton />

      {/* 3. MANIFESTO */}
      <ManifestoSection />

      {/* 4. HOW IT WORKS */}
      <HowItWorksSection />

      {/* 5. PRÉSENTATION DU MENU */}
      <MenuPresentation
        onSaladClick={handleSaladClick}
        onHotDishClick={handleHotDishClick}
        onDrinksClick={handleDrinksClick}
        onDessertsClick={handleDessertsClick}
      />

      {/* 7. ATMOSPHERE */}
      <Atmosphere />

      {/* 8. TESTIMONIALS */}
      <TestimonialsSection />

      {/* 9. CALL TO ACTION */}
      <CallToActionSection onStartOrder={handleStartOrder} />
    </div>
  );
};

export default Home;
