import React from 'react';
import { Link } from 'react-router-dom';
import './ThankYou.css';

function ThankYou() {
  return (
    <div id="thank-you-page" className="thank-you-page">
      <div className="thank-you-container">
        <div className="thank-you-icon">✓</div>
        <h1 className="thank-you-headline">Your EDDM campaign request is in.</h1>
        <p className="thank-you-subhead">
          We're reviewing your routes and will send your full quote shortly.
        </p>

        <div className="thank-you-contact">
          <p>Questions? Call us at:</p>
          <a href="tel:+18005551234" className="thank-you-phone">(800) 555-1234</a>
        </div>

        <Link to="/" className="thank-you-button">
          Plan Another Campaign
        </Link>
      </div>
    </div>
  );
}

export default ThankYou;
