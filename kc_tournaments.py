"""Module for creating a KC-based IFPA ranking."""

import argparse
import pickle
import time
from collections import OrderedDict
from datetime import date

import cachetools
import requests

parser = argparse.ArgumentParser()
parser.add_argument('apikey', help='IFPA API key to access IFPA data')
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
args = parser.parse_args()

try:
    with open('mycache.pickle', 'rb') as f:
        cache = pickle.load(f)
except FileNotFoundError:
    cache = {}

api_key = args.apikey
year = args.year
radius = args.range
max_results = args.max
startDate = time.strptime(f'{year}-01-01', '%Y-%m-%d')


def get_tournaments() -> requests.Response:
    """Get the tournaments from the IFPA API

    Returns:
        requests.Response: Response from the IFPA API
    """
    payload = {
        'start_date': f'{year - 1}-10-01',
        'end_date': f'{year}-12-31',
        'rank_type': 'MAIN',
        'total': 200,
        'only_with_results': 'Y',
        'latitude': 39.099724,
        'longitude': -94.578331,
        'radius': radius,
        'distance_unit': 'm for Miles',
        'api_key': api_key,
    }
    url = 'https://api.ifpapinball.com/tournament/search'
    return requests.get(url, params=payload, timeout=10)


@cachetools.cached(cache)
def get_tournament_results(tournament_id: int) -> requests.Response:
    """Get the tournament results for the given tournament

    Args:
        tournament_id (integer): Tournament id to query

    Returns:
        requests.Response: Response from the IFPA API
    """
    payload = {
        'api_key': api_key,
    }
    url = f'https://api.ifpapinball.com/tournament/{tournament_id}/results'
    return requests.get(url, params=payload, timeout=10)


response = get_tournaments()

if response.ok:
    json = response.json()
    search_total = int(json['total_results'])
    if search_total > len(json['tournaments']):
        print(
            f'WARNING: search matched {search_total} tournaments but only '
            f'{len(json["tournaments"])} were returned; reduce --range'
        )
    players = {}
    tournament_count = 0
    for tournament in json['tournaments']:
        if time.strptime(tournament['event_end_date'], '%Y-%m-%d') < startDate:
            continue
        tournament_name = tournament['tournament_name']

        resultsResponse = get_tournament_results(tournament['tournament_id'])
        if resultsResponse.ok:
            results = resultsResponse.json()
            if 'results' not in results:
                print(f'No results for {tournament_name}')
                continue
            tournament_count += 1
            # print(f'Got results for {tournament_name}')
            for result in results['results']:
                player_id = result['player_id']
                if player_id not in players:
                    players[player_id] = {'name': result['name'], 'points': []}
                players[player_id]['points'].append(float(result['points']))
        else:
            print(f'Failed to get results for {tournament_name}')
    for v in players.values():
        v['points'].sort(reverse=True)
        v['counted'] = len(v['points'][:max_results])
        v['total'] = sum(v['points'][:max_results])

    ordered = OrderedDict(
        sorted(players.items(), reverse=True, key=lambda item: item[1]['total'])
    )
    timestamp = date.today()
    if year != timestamp.year:
        timestamp = year

    print(f'KC Standings ({timestamp}):')
    print(f'Number of tournaments: {tournament_count}')
    print(f'Number of unique players: {len(players)}')
    print(
        f'{"Rank":<5}'
        f'{"Player":25}'
        f'{"Events":>8}'
        f'{"Points":>10}'
        f'{"Avg":>8}    '
        '(Total Events - Points)'
    )
    i = 1
    for i, v in enumerate(ordered.values(), start=1):
        print(
            f'{i:<5}'
            f'{v["name"]:25}'
            f'{v["counted"]:8}'
            f'{round(v["total"], 2):10}'
            f'{round(v["total"] / v["counted"], 2):>8}    '
            f'({len(v["points"])} - {round(sum(v["points"]), 2)})'
        )
        if (args.top > 0) and (i >= args.top):
            break

with open('mycache.pickle', 'wb') as f:
    pickle.dump(cache, f)
