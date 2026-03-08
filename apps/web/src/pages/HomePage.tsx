import { Feed } from "../components/feed/Feed";
import { PostComposer } from "../components/feed/PostComposer";

export default function HomePage() {
  return (
    <div className="mx-auto flex w-full max-w-[46rem] flex-col gap-5 pb-8">
      <PostComposer />
      <Feed />
    </div>
  );
}
