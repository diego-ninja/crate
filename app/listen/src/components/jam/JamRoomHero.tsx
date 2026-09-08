import { type JamRoomHeroProps } from "./JamRoomHeroSections";
import { JamRoomActions } from "./JamRoomActions";
import { JamRoomHeader } from "./JamRoomHeaderSections";
import { JamNowPlaying } from "./JamRoomPlaybackSections";

export function JamRoomHero(props: JamRoomHeroProps) {
  return (
    <div className="jam-room-header rounded-[12px] p-5 sm:p-6">
      <div className="flex flex-col gap-5">
        <JamRoomHeader {...props} />
        <JamNowPlaying {...props} />
        <JamRoomActions {...props} />
      </div>
    </div>
  );
}
