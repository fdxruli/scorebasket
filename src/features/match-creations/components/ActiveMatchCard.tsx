import type { Match } from '../../../db/models/Match';
import { TraditionalLiveCard } from './Live/TraditionalLiveCard';
import { RaceLiveCard } from './Live/RaceLiveCard';
import { SeriesLiveCard } from './Live/SeriesLiveCard';
interface Props {
    match: Match;
    localName: string;
    visitorName: string;
}

export const ActiveMatchCard = (props: Props) => {
    const mode = props.match.config?.mode || 'traditional';

    switch (mode) {
        case 'race':
            return <RaceLiveCard {...props} />;
        case 'best-of-series':
            return <SeriesLiveCard {...props} />;
        case 'traditional':
        default:
            return <TraditionalLiveCard {...props} />;
    }
};