require "net/http"
require "zlib"
require "json"

# Imports the Magic set list and the "which illustration is in which set" catalog from Scryfall.
#
# - Sets come from https://api.scryfall.com/sets (one small JSON request).
# - Printings come from the "default_cards" bulk file (~80 MB gzipped JSON Lines, one card per line),
#   streamed to a temp file and read line by line so memory stays low.
#
# The printings table is rebuilt from scratch in a single transaction, so readers never see it half-filled.
class CatalogImport
  API = "https://api.scryfall.com"
  HEADERS = { "User-Agent" => "Artscry/1.0", "Accept" => "application/json" }.freeze
  BATCH = 5_000

  def initialize(logger: Rails.logger)
    @logger = logger
  end

  def call
    import_sets
    import_printings
    refresh_counts
    @logger.info "[catalog] #{CardSet.count} sets, #{Printing.count} printings"
  end

  private
    def import_sets
      now = Time.current
      rows = get_json("#{API}/sets").fetch("data").map do |s|
        {
          code: s["code"], name: s["name"], set_type: s["set_type"], released_at: s["released_at"],
          icon_svg_uri: s["icon_svg_uri"], parent_set_code: s["parent_set_code"], digital: !!s["digital"],
          created_at: now, updated_at: now
        }
      end
      CardSet.upsert_all(rows, unique_by: :code, update_only: %i[name set_type released_at icon_svg_uri parent_set_code digital])
    end

    def import_printings
      file = download_bulk("default_cards")
      Printing.transaction do
        Printing.delete_all
        batch = Set.new
        Zlib::GzipReader.open(file.path) do |gz|
          gz.each_line do |line|
            line = line.strip.delete_suffix(",")
            next unless line.start_with?("{")
            card = JSON.parse(line)
            illustration_ids(card).each { |ill| batch << { set_code: card["set"], illustration_id: ill } }
            if batch.size >= BATCH
              Printing.insert_all(batch.to_a, unique_by: %i[set_code illustration_id])
              batch.clear
            end
          end
        end
        Printing.insert_all(batch.to_a, unique_by: %i[set_code illustration_id]) if batch.any?
      end
    ensure
      file&.close!
    end

    # A card has one illustration, or one per face (double-faced cards).
    def illustration_ids(card)
      ids = [ card["illustration_id"] ]
      ids += Array(card["card_faces"]).map { |f| f["illustration_id"] }
      ids.compact.uniq
    end

    def refresh_counts
      counts = Printing.group(:set_code).count
      CardSet.find_each do |set|
        n = counts.fetch(set.code, 0)
        set.update_column(:illustration_count, n) if set.illustration_count != n
      end
    end

    def download_bulk(type)
      meta = get_json("#{API}/bulk-data/#{type}")
      url = meta["jsonl_download_uri"] or raise "No JSON Lines download for #{type}"
      @logger.info "[catalog] downloading #{url}"
      file = Tempfile.new([ "scryfall-#{type}", ".jsonl.gz" ], binmode: true)
      stream(url) { |chunk| file.write(chunk) }
      file.flush
      file
    end

    def get_json(url)
      body = +""
      stream(url) { |chunk| body << chunk }
      JSON.parse(body)
    end

    def stream(url, redirects: 3, &block)
      uri = URI(url)
      Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https", read_timeout: 120) do |http|
        http.request(Net::HTTP::Get.new(uri, HEADERS)) do |res|
          case res
          when Net::HTTPSuccess then res.read_body(&block)
          when Net::HTTPRedirection
            raise "Too many redirects" if redirects.zero?
            return stream(res["location"], redirects: redirects - 1, &block)
          else raise "Scryfall returned #{res.code} for #{url}"
          end
        end
      end
    end
end
