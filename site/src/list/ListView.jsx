import games from '../../../pipeline/games.json';

const statusColor = {
  brainstormed: 'bg-gb-dark text-gb-lightest',
  approved: 'bg-gb-light text-gb-darkest',
  building: 'bg-yellow-700 text-gb-lightest',
  testing: 'bg-blue-700 text-gb-lightest',
  deployed: 'bg-gb-lightest text-gb-darkest',
};

export default function ListView() {
  const deployed = games.filter((g) => g.status === 'deployed');

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-xl tracking-widest mb-4">GAMES</h1>
      {deployed.length === 0 ? (
        <p className="text-gb-light">No games yet — check back tomorrow.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {deployed.map((g) => (
            <a
              key={g.id}
              href={`/games/${g.id}`}
              className="block border border-gb-dark p-4 hover:bg-gb-dark transition"
            >
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-bold">{g.name}</h2>
                <span className={`text-[10px] px-2 py-0.5 ${statusColor[g.status]}`}>
                  {g.status}
                </span>
              </div>
              <p className="text-xs text-gb-light">{g.coopSpin}</p>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
