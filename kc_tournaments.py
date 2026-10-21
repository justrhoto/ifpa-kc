"""Module for creating a KC-based IFPA ranking."""

import argparse
import json
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

KC_LATITUDE = 39.099724
KC_LONGITUDE = -94.578331
SEARCH_LIMIT = 200
PLAYER_BATCH_SIZE = 50
CACHE_FILE = Path('results_cache.json')
# Results for recent events can still be corrected, so only cache older ones.
CACHE_MIN_AGE = timedelta(days=14)


def parse_args() -> argparse.Namespace:
    """Parse the command line arguments

    Returns:
        argparse.Namespace: Parsed arguments
    """
    parser = argparse.ArgumentParser()
    parser.add_argument(
        'apikey',
        nargs='?',
        default=os.environ.get('IFPA_API_KEY'),
        help='IFPA API key to access IFPA data (defaults to $IFPA_API_KEY)',
    )
    parser.add_argument(
        '-r',
        '--range',
        help='Range in miles to include tournaments from city center',
        type=int,
        default=75,
    )
    parser.add_argument(
        '-y',
        '--year',
        help='The year to generate the rankings for',
        type=int,
        default=date.today().year,
    )
    parser.add_argument(
        '-m',
        '--max',
        help='The maximum number of tournaments that can affect ranking',
        type=int,
        default=20,
    )
    parser.add_argument(
        '-t',
        '--top',
        help='Top X players to print out; X < 1 will print all players',
        type=int,
        default=100,
    )
    parser.add_argument(
        '-j',
        '--json',
        help='Write the top players to this JSON file instead of printing',
        type=Path,
    )
    parser.add_argument(
        '-a',
        '--archive',
        help='Also write <year>.json for every year from --first-year '
        'through --year to this directory, plus a years.json index',
        type=Path,
    )
    parser.add_argument(
        '-f',
        '--first-year',
        help='The first year to write to --archive',
        type=int,
        default=2009,
    )
    args = parser.parse_args()
    if not args.apikey:
        parser.error('an API key is required (argument or $IFPA_API_KEY)')
    if args.first_year > args.year:
        parser.error('--first-year must not be after --year')
    return args


def get_tournaments(api_key: str, year: int, radius: int) -> dict:
    """Get the tournaments from the IFPA API

    Args:
        api_key (str): IFPA API key
        year (int): Year to search
        radius (int): Search radius in miles from the KC city center

    Returns:
        dict: Search response from the IFPA API
    """
    payload = {
        'start_date': f'{year - 1}-10-01',
        'end_date': f'{year}-12-31',
        'rank_type': 'MAIN',
        'total': SEARCH_LIMIT,
        'only_with_results': 'Y',
        'latitude': KC_LATITUDE,
        'longitude': KC_LONGITUDE,
        'radius': radius,
        'distance_unit': 'm for Miles',
        'api_key': api_key,
    }
    url = 'https://api.ifpapinball.com/tournament/search'
    response = requests.get(url, params=payload, timeout=10)
    response.raise_for_status()
    return response.json()


def get_tournament_results(
    api_key: str, tournament: dict, cache: dict
) -> dict | None:
    """Get the tournament results for the given tournament

    Only successful responses for events older than CACHE_MIN_AGE are cached,
    so a failed request is retried on the next run.

    Args:
        api_key (str): IFPA API key
        tournament (dict): Tournament from the search response
        cache (dict): Results cache keyed by tournament id

    Returns:
        dict | None: Results from the IFPA API, or None if the request failed
    """
    tournament_id = str(tournament['tournament_id'])
    if tournament_id in cache:
        return cache[tournament_id]

    url = f'https://api.ifpapinball.com/tournament/{tournament_id}/results'
    response = requests.get(url, params={'api_key': api_key}, timeout=10)
    if not response.ok:
        return None
    results = response.json()
    end_date = date.fromisoformat(tournament['event_end_date'])
    if 'results' in results and date.today() - end_date >= CACHE_MIN_AGE:
        cache[tournament_id] = results
    return results


def get_player_photos(api_key: str, player_ids: list[str]) -> dict:
    """Get the IFPA profile photo URL for each player

    Photos are optional, so a failed request just leaves those players out.

    Args:
        api_key (str): IFPA API key
        player_ids (list[str]): Player ids to look up

    Returns:
        dict: Photo URL keyed by player id, for players that have one
    """
    photos = {}
    for i in range(0, len(player_ids), PLAYER_BATCH_SIZE):
        batch = player_ids[i : i + PLAYER_BATCH_SIZE]
        payload = {'api_key': api_key, 'players': ','.join(batch)}
        url = 'https://api.ifpapinball.com/player'
        try:
            response = requests.get(url, params=payload, timeout=20)
            response.raise_for_status()
            players = response.json().get('player', [])
        except (requests.RequestException, ValueError):
            print(f'Failed to get photos for {len(batch)} players')
            continue
        for player in players:
            if player.get('profile_photo'):
                photos[str(player['player_id'])] = player['profile_photo']
    return photos


def build_standings(
    api_key: str, year: int, radius: int, max_results: int, cache: dict
) -> dict:
    """Build the standings for the given year

    Args:
        api_key (str): IFPA API key
        year (int): Year to rank
        radius (int): Search radius in miles from the KC city center
        max_results (int): Most events that count toward a player's total
        cache (dict): Results cache keyed by tournament id

    Returns:
        dict: Tournament count, search details and players sorted by total
    """
    search = get_tournaments(api_key, year, radius)
    # A search with no matches leaves out the tournaments list entirely.
    tournaments = search.get('tournaments', [])
    search_total = int(search['total_results'])
    if search_total > len(tournaments):
        print(
            f'WARNING: search matched {search_total} tournaments but only '
            f'{len(tournaments)} were returned; reduce --range'
        )

    start_date = date(year, 1, 1)
    players = {}
    tournament_count = 0
    for tournament in tournaments:
        if date.fromisoformat(tournament['event_end_date']) < start_date:
            continue
        tournament_name = tournament['tournament_name']

        results = get_tournament_results(api_key, tournament, cache)
        if results is None:
            print(f'Failed to get results for {tournament_name}')
            continue
        if 'results' not in results:
            print(f'No results for {tournament_name}')
            continue
        tournament_count += 1
        for result in results['results']:
            player_id = result['player_id']
            if player_id not in players:
                players[player_id] = {
                    'player_id': player_id,
                    'name': result['name'].strip(),
                    'points': [],
                }
            players[player_id]['points'].append(float(result['points']))

    for v in players.values():
        v['points'].sort(reverse=True)
        v['counted'] = len(v['points'][:max_results])
        v['total'] = sum(v['points'][:max_results])

    ordered = sorted(players.values(), reverse=True, key=lambda v: v['total'])
    return {'tournament_count': tournament_count, 'players': ordered}


def print_standings(standings: dict, year: int, top: int) -> None:
    """Print the standings as a table

    Args:
        standings (dict): Standings from build_standings
        year (int): Year that was ranked
        top (int): Number of players to print; < 1 prints all players
    """
    players = standings['players']
    timestamp = date.today()
    if year != timestamp.year:
        timestamp = year

    print(f'KC Standings ({timestamp}):')
    print(f'Number of tournaments: {standings["tournament_count"]}')
    print(f'Number of unique players: {len(players)}')
    print(
        f'{"Rank":<5}'
        f'{"Player":25}'
        f'{"Events":>8}'
        f'{"Points":>10}'
        f'{"Avg":>8}    '
        '(Total Events - Points)'
    )
    for i, v in enumerate(players, start=1):
        print(
            f'{i:<5}'
            f'{v["name"]:25}'
            f'{v["counted"]:8}'
            f'{round(v["total"], 2):10}'
            f'{round(v["total"] / v["counted"], 2):>8}    '
            f'({len(v["points"])} - {round(sum(v["points"]), 2)})'
        )
        if (top > 0) and (i >= top):
            break


def standings_json(
    standings: dict,
    api_key: str,
    year: int,
    radius: int,
    max_results: int,
    top: int,
) -> dict:
    """Build the JSON data the site pages read for one year

    Args:
        standings (dict): Standings from build_standings
        api_key (str): IFPA API key, used to look up profile photos
        year (int): Year that was ranked
        radius (int): Search radius in miles
        max_results (int): Most events that count toward a player's total
        top (int): Number of players to include; < 1 includes all players

    Returns:
        dict: Summary details and the top players
    """
    players = standings['players']
    if top > 0:
        players = players[:top]
    photos = get_player_photos(api_key, [str(v['player_id']) for v in players])
    return {
        'generated_at': now_iso(),
        'year': year,
        'radius_miles': radius,
        'max_events': max_results,
        'tournament_count': standings['tournament_count'],
        'player_count': len(standings['players']),
        'players': [
            {
                'rank': i,
                'player_id': v['player_id'],
                'name': v['name'],
                'photo': photos.get(str(v['player_id'])),
                'events': v['counted'],
                'points': round(v['total'], 2),
                'average': round(v['total'] / v['counted'], 2),
                'total_events': len(v['points']),
                'total_points': round(sum(v['points']), 2),
            }
            for i, v in enumerate(players, start=1)
        ],
    }


def now_iso() -> str:
    """Current UTC time as an ISO 8601 string, to the second"""
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def write_json(data: dict, path: Path) -> None:
    """Write data to a JSON file, creating its directory if needed

    Args:
        data (dict): Data to write
        path (Path): File to write
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding='utf-8')
    print(f'Wrote {path}')


def write_archive(args: argparse.Namespace, cache: dict) -> None:
    """Write standings for every year to the archive directory

    The current year also goes to --json, so the kiosk and the archive share
    one build. Years without any results are left out of the index.

    Args:
        args (argparse.Namespace): Parsed arguments
        cache (dict): Results cache keyed by tournament id
    """
    years = []
    for year in range(args.year, args.first_year - 1, -1):
        standings = build_standings(args.apikey, year, args.range, args.max, cache)
        # Save as we go so an interrupted run keeps the results it fetched.
        CACHE_FILE.write_text(json.dumps(cache), encoding='utf-8')
        data = standings_json(
            standings, args.apikey, year, args.range, args.max, args.top
        )
        if year == args.year and args.json:
            write_json(data, args.json)
        if not data['players']:
            continue
        write_json(data, args.archive / f'{year}.json')
        years.append(
            {
                'year': year,
                'tournament_count': data['tournament_count'],
                'player_count': data['player_count'],
            }
        )
    write_json({'generated_at': now_iso(), 'years': years}, args.archive / 'years.json')


def main() -> None:
    """Build the KC standings and print them or write them as JSON"""
    args = parse_args()
    try:
        cache = json.loads(CACHE_FILE.read_text(encoding='utf-8'))
    except FileNotFoundError:
        cache = {}

    if args.archive:
        write_archive(args, cache)
    elif args.json:
        standings = build_standings(args.apikey, args.year, args.range, args.max, cache)
        write_json(
            standings_json(
                standings, args.apikey, args.year, args.range, args.max, args.top
            ),
            args.json,
        )
    else:
        standings = build_standings(args.apikey, args.year, args.range, args.max, cache)
        print_standings(standings, args.year, args.top)

    CACHE_FILE.write_text(json.dumps(cache), encoding='utf-8')


if __name__ == '__main__':
    main()
