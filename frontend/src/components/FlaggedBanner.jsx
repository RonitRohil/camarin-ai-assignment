const FlaggedBanner = ({ category }) => {
    return (
        <div className="flagged-banner" role="alert">
            <strong>Flagged for review</strong>
            {category ? <span> — {category}</span> : null}
        </div>
    );
};

export default FlaggedBanner;
